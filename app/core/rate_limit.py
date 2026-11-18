"""In-process sliding-window rate limiting for the API.

Limits are held in memory, so they are per API instance. That is enough for a
single Render instance and for blunting abuse and runaway costs (Gemini, Stripe,
uploads). If the API is scaled to several instances, move the counters to Redis
or enforce limits at the gateway; the rule table below stays the same.
"""
import base64
import json
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

Send = Callable[..., Awaitable[None]]
Receive = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class Rule:
    name: str
    limit: int
    window: int  # seconds


# Applied in order; every matching rule must pass.
AI = (Rule("ai-burst", 12, 60), Rule("ai-hour", 60, 3600))
UPLOAD = (Rule("upload", 40, 600),)
CHECKOUT = (Rule("checkout", 10, 600),)
CONTRIBUTE = (Rule("contribute", 40, 600),)
REPORT = (Rule("report", 10, 600),)
WRITE = (Rule("write", 120, 60),)
ANY = (Rule("any", 300, 60),)

# Anonymous or spoofed-identity callers are also counted per IP at this multiple.
IP_MULTIPLIER = 5
MAX_KEYS = 50_000
EXEMPT_PREFIXES = ("/health", "/api/internal/", "/api/support/stripe-webhook")


def rules_for(method: str, path: str) -> tuple[Rule, ...]:
    if method in ("OPTIONS", "HEAD") or path.startswith(EXEMPT_PREFIXES):
        return ()
    rules: list[Rule] = list(ANY)
    if method == "GET":
        return tuple(rules)
    if "/agent/chat" in path or "/manuscript/" in path:
        rules += AI
    elif "/assets/upload-url" in path or path.endswith("/assets/complete"):
        rules += UPLOAD
    elif path.endswith("/support/checkout"):
        rules += CHECKOUT
    elif path.endswith("/reports"):
        rules += REPORT
    elif path.endswith(("/reactions", "/reviews", "/helpful")):
        rules += CONTRIBUTE
    rules += WRITE
    return tuple(rules)


def client_ip(scope: dict[str, Any], proxy_hops: int) -> str:
    """Address added by our own proxy; earlier X-Forwarded-For entries are client-controlled."""
    headers = dict(scope.get("headers", []))
    forwarded = headers.get(b"x-forwarded-for", b"").decode("latin-1")
    parts = [p.strip() for p in forwarded.split(",") if p.strip()]
    if proxy_hops > 0 and len(parts) >= proxy_hops:
        return parts[-proxy_hops]
    client = scope.get("client")
    return client[0] if client else "unknown"


def token_subject(scope: dict[str, Any]) -> str | None:
    """User id from the bearer token. Not verified here (the routes verify it); it only picks a bucket."""
    auth = dict(scope.get("headers", [])).get(b"authorization", b"").decode("latin-1")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        payload = auth[7:].split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        sub = data.get("sub")
        return str(sub)[:64] if sub else None
    except Exception:
        return None


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self.hits: dict[tuple[str, str], deque[float]] = {}

    def check(self, key: str, rule: Rule, limit: int | None = None) -> int:
        """Record a hit. Returns 0 if allowed, otherwise seconds until retry."""
        now = self.clock()
        cap = limit if limit is not None else rule.limit
        bucket_key = (rule.name, key)
        bucket = self.hits.get(bucket_key)
        if bucket is None:
            if len(self.hits) >= MAX_KEYS:
                self._sweep(now)
            bucket = self.hits[bucket_key] = deque()
        while bucket and bucket[0] <= now - rule.window:
            bucket.popleft()
        if len(bucket) >= cap:
            return max(1, int(bucket[0] + rule.window - now) + 1)
        bucket.append(now)
        return 0

    def _sweep(self, now: float) -> None:
        longest = max(r.window for r in (*AI, *UPLOAD, *CHECKOUT, *CONTRIBUTE, *REPORT, *WRITE, *ANY))
        for k in [k for k, b in self.hits.items() if not b or b[-1] <= now - longest]:
            del self.hits[k]
        if len(self.hits) >= MAX_KEYS:  # still full: drop the oldest half
            for k in sorted(self.hits, key=lambda k: self.hits[k][-1])[: MAX_KEYS // 2]:
                del self.hits[k]


class RateLimitMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]], proxy_hops: int = 1, limiter: RateLimiter | None = None):
        self.app = app
        self.proxy_hops = proxy_hops
        self.limiter = limiter or RateLimiter()

    async def __call__(self, scope: dict[str, Any], receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        rules = rules_for(scope.get("method", "GET"), scope.get("path", ""))
        if rules:
            ip = client_ip(scope, self.proxy_hops)
            sub = token_subject(scope)
            retry = 0
            for rule in rules:
                if sub:
                    retry = max(retry, self.limiter.check(f"u:{sub}", rule))
                retry = max(retry, self.limiter.check(f"ip:{ip}", rule, rule.limit * (IP_MULTIPLIER if sub else 1)))
            if retry:
                body = b'{"detail":"Too many requests. Please wait a moment and try again."}'
                await send({"type": "http.response.start", "status": 429, "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"retry-after", str(retry).encode("ascii")),
                ]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
