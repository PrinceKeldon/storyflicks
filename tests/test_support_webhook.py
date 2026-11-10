import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from app.api.routes import support
from app.core.security import AuthenticatedUser

WEBHOOK_SECRET = "whsec_test_secret"


class FakeSupabase:
    def __init__(self, insert_error: Exception | None = None):
        self.insert_error = insert_error
        self.calls: list[tuple] = []

    async def admin_get(self, table, params=None):
        self.calls.append(("get", table))
        return [{"id": params["id"].removeprefix("eq."), "title": "Story", "slug": "story", "author_name": None}]

    async def admin_insert(self, table, payload):
        self.calls.append(("insert", table, payload))
        if self.insert_error:
            raise self.insert_error

    async def admin_insert_if_missing(self, table, payload, on_conflict):
        self.calls.append(("insert_if_missing", table, payload, on_conflict))

    async def admin_patch(self, table, params, payload):
        self.calls.append(("patch", table, params, payload))


class FakeRequest:
    def __init__(self, payload: bytes):
        self._payload = payload

    async def body(self):
        return self._payload


def signed(event: dict) -> tuple[FakeRequest, str]:
    payload = json.dumps(event).encode()
    timestamp = str(int(time.time()))
    digest = hmac.new(
        WEBHOOK_SECRET.encode(), timestamp.encode() + b"." + payload, hashlib.sha256
    ).hexdigest()
    return FakeRequest(payload), f"t={timestamp},v1={digest}"


def paid_event(**overrides) -> dict:
    session = {
        "id": "cs_test_123",
        "payment_status": "paid",
        "payment_intent": "pi_test_123",
        "amount_total": 500,
        "currency": "eur",
        "metadata": {
            "purpose": "reader_support",
            "user_id": str(uuid4()),
            "story_id": str(uuid4()),
        },
    }
    session.update(overrides)
    return {"type": "checkout.session.completed", "data": {"object": session}}


class WebhookTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fake = FakeSupabase()
        for patcher in (
            patch.object(support, "supabase", self.fake),
            patch.object(support.settings, "stripe_webhook_secret", WEBHOOK_SECRET),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    async def deliver(self, event: dict):
        request, signature = signed(event)
        return await support.stripe_support_webhook(request, signature)

    async def test_paid_event_creates_missing_row_then_marks_it_paid(self):
        event = paid_event()
        session = event["data"]["object"]

        result = await self.deliver(event)

        self.assertEqual(result, {"received": True})
        insert_call, patch_call = self.fake.calls
        self.assertEqual(insert_call[0], "insert_if_missing")
        row = insert_call[2]
        self.assertEqual(row["stripe_checkout_session_id"], "cs_test_123")
        self.assertEqual(row["user_id"], session["metadata"]["user_id"])
        self.assertEqual(row["story_id"], session["metadata"]["story_id"])
        self.assertEqual((row["amount_cents"], row["currency"]), (500, "eur"))
        self.assertEqual(insert_call[3], "stripe_checkout_session_id")
        self.assertEqual(patch_call[0], "patch")
        self.assertEqual(
            patch_call[2],
            {"stripe_checkout_session_id": "eq.cs_test_123", "status": "neq.paid"},
        )
        self.assertEqual(patch_call[3]["status"], "paid")
        self.assertEqual(patch_call[3]["stripe_payment_intent_id"], "pi_test_123")

    async def test_unusable_metadata_is_ignored_and_logged(self):
        event = paid_event()
        event["data"]["object"]["metadata"]["user_id"] = "not-a-uuid"

        with self.assertLogs(support.logger, level="ERROR"):
            result = await self.deliver(event)

        self.assertEqual(result, {"received": True, "ignored": True})
        self.assertEqual(self.fake.calls, [])

    async def test_amount_or_currency_we_never_create_is_ignored(self):
        for overrides in ({"amount_total": 100}, {"amount_total": 60000}, {"currency": "usd"}):
            with self.subTest(overrides=overrides), self.assertLogs(support.logger, level="ERROR"):
                result = await self.deliver(paid_event(**overrides))
            self.assertEqual(result, {"received": True, "ignored": True})
        self.assertEqual(self.fake.calls, [])

    async def test_unpaid_session_is_ignored(self):
        result = await self.deliver(paid_event(payment_status="unpaid"))

        self.assertEqual(result, {"received": True, "ignored": True})
        self.assertEqual(self.fake.calls, [])


class FakeStripeResponse:
    status_code = 200

    def json(self):
        return {"id": "cs_test_999", "url": "https://checkout.stripe.test/cs_test_999"}


class FakeStripeClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, url, headers=None, content=None):
        return FakeStripeResponse()


class CheckoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_checkout_url_is_returned_when_the_pending_row_cannot_be_written(self):
        fake = FakeSupabase(insert_error=HTTPException(status_code=502, detail="database down"))
        with (
            patch.object(support, "supabase", fake),
            patch.object(support.settings, "stripe_secret_key", "sk_test_x"),
            patch.object(support.httpx, "AsyncClient", FakeStripeClient),
            self.assertLogs(support.logger, level="WARNING"),
        ):
            result = await support.create_support_checkout(
                support.SupportCheckoutRequest(story_id=uuid4(), amount_cents=500),
                AuthenticatedUser(id=str(uuid4()), email=None, access_token="t"),
            )

        self.assertEqual(result["checkout_url"], "https://checkout.stripe.test/cs_test_999")
        self.assertTrue(any(call[0] == "insert" for call in fake.calls))


if __name__ == "__main__":
    unittest.main()
