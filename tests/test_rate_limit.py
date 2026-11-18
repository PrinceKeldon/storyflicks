import base64
import json
import unittest

from app.core.rate_limit import RateLimiter, RateLimitMiddleware, Rule, client_ip, rules_for, token_subject


def jwt(sub):
    body = base64.urlsafe_b64encode(json.dumps({"sub": sub}).encode()).decode().rstrip("=")
    return f"h.{body}.s"


def scope(method="POST", path="/api/creator/agent/chat", ip="1.1.1.1", sub=None, xff=None):
    headers = []
    if sub:
        headers.append((b"authorization", f"Bearer {jwt(sub)}".encode()))
    if xff:
        headers.append((b"x-forwarded-for", xff.encode()))
    return {"type": "http", "method": method, "path": path, "headers": headers, "client": (ip, 1)}


class Clock:
    now = 1000.0
    def __call__(self):
        return self.now


class RateLimitTests(unittest.IsolatedAsyncioTestCase):
    async def run_request(self, mw, sc):
        sent = []
        called = []
        async def app(s, r, snd):
            called.append(1)
        async def send(m):
            sent.append(m)
        mw.app = app
        await mw(sc, None, send)
        return called, sent

    def test_sliding_window_allows_again_after_window(self):
        clock = Clock()
        limiter = RateLimiter(clock)
        rule = Rule("t", 2, 60)
        self.assertEqual(limiter.check("a", rule), 0)
        self.assertEqual(limiter.check("a", rule), 0)
        self.assertGreater(limiter.check("a", rule), 0)
        self.assertEqual(limiter.check("b", rule), 0)
        clock.now += 61
        self.assertEqual(limiter.check("a", rule), 0)

    def test_rules_cover_expensive_routes_and_exempt_webhooks(self):
        names = lambda m, p: {r.name for r in rules_for(m, p)}
        self.assertIn("ai-burst", names("POST", "/api/creator/agent/chat"))
        self.assertIn("ai-burst", names("POST", "/api/creator/stories/x/manuscript/analyse"))
        self.assertIn("checkout", names("POST", "/api/support/checkout"))
        self.assertIn("upload", names("POST", "/api/creator/stories/x/assets/upload-url"))
        self.assertIn("report", names("POST", "/api/reports"))
        self.assertEqual(names("GET", "/api/stories"), {"any"})
        self.assertEqual(rules_for("POST", "/api/support/stripe-webhook"), ())
        self.assertEqual(rules_for("POST", "/api/internal/publish-due-episodes"), ())
        self.assertEqual(rules_for("OPTIONS", "/api/creator/agent/chat"), ())

    def test_client_ip_uses_last_proxy_hop_not_spoofed_value(self):
        self.assertEqual(client_ip(scope(xff="6.6.6.6, 9.9.9.9"), 1), "9.9.9.9")
        self.assertEqual(client_ip(scope(ip="2.2.2.2"), 1), "2.2.2.2")
        self.assertEqual(client_ip(scope(xff="6.6.6.6", ip="2.2.2.2"), 0), "2.2.2.2")

    def test_token_subject(self):
        self.assertEqual(token_subject(scope(sub="user-1")), "user-1")
        self.assertIsNone(token_subject(scope()))
        bad = scope()
        bad["headers"] = [(b"authorization", b"Bearer garbage")]
        self.assertIsNone(token_subject(bad))

    async def test_ai_burst_blocked_with_429_and_retry_after(self):
        mw = RateLimitMiddleware(None, limiter=RateLimiter(Clock()))
        for _ in range(12):
            called, _ = await self.run_request(mw, scope(sub="u1"))
            self.assertEqual(called, [1])
        called, sent = await self.run_request(mw, scope(sub="u1"))
        self.assertEqual(called, [])
        self.assertEqual(sent[0]["status"], 429)
        self.assertIn(b"retry-after", dict(sent[0]["headers"]))
        # A different user from a different IP is unaffected.
        called, _ = await self.run_request(mw, scope(sub="u2", xff="x, 3.3.3.3"))
        self.assertEqual(called, [1])

    async def test_rotating_fake_subjects_is_still_stopped_per_ip(self):
        mw = RateLimitMiddleware(None, limiter=RateLimiter(Clock()))
        blocked = 0
        for i in range(100):
            called, _ = await self.run_request(mw, scope(sub=f"fake-{i}", ip="4.4.4.4"))
            blocked += 0 if called else 1
        self.assertGreater(blocked, 0)

    async def test_webhook_never_limited(self):
        mw = RateLimitMiddleware(None, limiter=RateLimiter(Clock()))
        for _ in range(500):
            called, _ = await self.run_request(mw, scope(path="/api/support/stripe-webhook"))
            self.assertEqual(called, [1])


if __name__ == "__main__":
    unittest.main()
