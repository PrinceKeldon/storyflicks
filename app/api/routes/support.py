import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
import time
from uuid import UUID, uuid4
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, supabase
from app.core.config import settings
from app.core.security import AuthenticatedUser

logger = logging.getLogger(__name__)

router = APIRouter()


class SupportCheckoutRequest(BaseModel):
    story_id: UUID
    amount_cents: int = Field(ge=200, le=50000)


@router.post("/support/checkout")
async def create_support_checkout(
    submission: SupportCheckoutRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    if not settings.stripe_secret_key or not settings.stripe_secret_key.startswith("sk_test_"):
        raise HTTPException(503, "Reader support sandbox payments are not configured yet.")

    if submission.amount_cents % 100 != 0:
        raise HTTPException(422, "Choose a whole-euro contribution amount.")
    if submission.amount_cents < 200 or submission.amount_cents > 50000:
        raise HTTPException(422, "Contributions must be between €2 and €500.")

    stories = await supabase.admin_get(
        "stories",
        {
            "id": f"eq.{submission.story_id}",
            "publication_status": "eq.published",
            "select": "id,title,slug,author_name",
            "limit": "1",
        },
    )
    if not stories:
        raise HTTPException(404, "This story is not available for support.")

    story = stories[0]
    base_url = settings.frontend_base_url.rstrip("/")
    amount_label = f"€{submission.amount_cents / 100:.2f}"
    form = {
        "mode": "payment",
        "submit_type": "pay",
        "success_url": f"{base_url}/support/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base_url}/stories/{story['slug']}?support=cancelled",
        "client_reference_id": user.id,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": str(submission.amount_cents),
        "line_items[0][price_data][product_data][name]": f"Support for {story['title']}",
        "line_items[0][price_data][product_data][description]": "Voluntary reader support for independent storytelling.",
        "metadata[story_id]": str(story["id"]),
        "metadata[story_slug]": story["slug"],
        "metadata[user_id]": user.id,
        "metadata[purpose]": "reader_support",
        "payment_intent_data[metadata][story_id]": str(story["id"]),
        "payment_intent_data[metadata][user_id]": user.id,
        "payment_intent_data[metadata][purpose]": "reader_support",
    }
    if user.email:
        form["customer_email"] = user.email
    headers = {
        "Authorization": f"Bearer {settings.stripe_secret_key}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": f"story-support:{uuid4()}",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://api.stripe.com/v1/checkout/sessions",
                headers=headers,
                content=urlencode(form),
            )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "We could not start secure checkout. Please try again.") from exc

    if response.status_code >= 400:
        raise HTTPException(502, "Stripe could not start checkout. Please try again.")
    session = response.json()
    if not session.get("id") or not session.get("url"):
        raise HTTPException(502, "Stripe returned an incomplete checkout session.")

    # The Checkout Session already exists at this point and the table needs its
    # ID, so the pending record can only be written now. Do not fail the reader
    # if that write fails: the session is live and they may pay, and the
    # webhook records the contribution from the verified event either way.
    try:
        await supabase.admin_insert(
            "reader_support_contributions",
            {
                "user_id": user.id,
                "story_id": str(story["id"]),
                "stripe_checkout_session_id": session["id"],
                "amount_cents": submission.amount_cents,
                "currency": "eur",
                "status": "pending",
            },
        )
    except (HTTPException, httpx.HTTPError):
        logger.warning(
            "Could not record the pending contribution for Checkout Session %s; "
            "the webhook will record it if the payment completes.",
            session["id"],
        )
    return {"checkout_url": session["url"], "amount": amount_label}


def _contribution_from_paid_session(session: dict) -> dict | None:
    """Build a contribution row from a verified, paid Checkout Session.

    Returns None when the session does not carry the data our checkout always
    sets (valid user and story IDs, a euro amount within the allowed range).
    """
    metadata = session.get("metadata") or {}
    try:
        user_id = str(UUID(str(metadata.get("user_id"))))
        story_id = str(UUID(str(metadata.get("story_id"))))
    except ValueError:
        return None
    amount = session.get("amount_total")
    if (
        not isinstance(amount, int)
        or isinstance(amount, bool)
        or not 200 <= amount <= 50000
        or str(session.get("currency", "")).lower() != "eur"
    ):
        return None
    return {
        "user_id": user_id,
        "story_id": story_id,
        "stripe_checkout_session_id": session["id"],
        "amount_cents": amount,
        "currency": "eur",
        "status": "pending",
    }


def _verify_stripe_signature(payload: bytes, signature_header: str, secret: str) -> bool:
    timestamp = None
    signatures: list[str] = []
    for item in signature_header.split(","):
        key, separator, value = item.partition("=")
        if not separator:
            continue
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp or not signatures:
        return False
    try:
        timestamp_int = int(timestamp)
    except ValueError:
        return False
    if abs(int(time.time()) - timestamp_int) > 300:
        return False
    signed_payload = timestamp.encode() + b"." + payload
    expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


@router.post("/support/stripe-webhook")
async def stripe_support_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
):
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Stripe webhook is not configured.")
    if not stripe_signature:
        raise HTTPException(400, "Missing Stripe signature.")

    payload = await request.body()
    if not _verify_stripe_signature(payload, stripe_signature, settings.stripe_webhook_secret):
        raise HTTPException(400, "Invalid Stripe signature.")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Invalid webhook payload.") from exc

    event_type = event.get("type")
    session = (event.get("data") or {}).get("object") or {}
    if event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        if session.get("payment_status") != "paid":
            return {"received": True, "ignored": True}
        session_id = session.get("id")
        metadata = session.get("metadata") or {}
        if not session_id or metadata.get("purpose") != "reader_support":
            return {"received": True, "ignored": True}
        contribution = _contribution_from_paid_session(session)
        if contribution is None:
            # Signed by Stripe but not shaped like one of our checkouts, so it
            # cannot be recorded. Make it findable instead of dropping it silently.
            logger.error(
                "Paid Checkout Session %s has unusable metadata or amount; not recorded.",
                session_id,
            )
            return {"received": True, "ignored": True}
        # Make sure a row exists (the checkout request may have failed to write
        # it), then mark it paid. Only rows not already paid are updated, so a
        # repeated event keeps the original paid_at.
        await supabase.admin_insert_if_missing(
            "reader_support_contributions",
            contribution,
            on_conflict="stripe_checkout_session_id",
        )
        await supabase.admin_patch(
            "reader_support_contributions",
            {
                "stripe_checkout_session_id": f"eq.{session_id}",
                "status": "neq.paid",
            },
            {
                "status": "paid",
                "stripe_payment_intent_id": session.get("payment_intent"),
                "paid_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    elif event_type == "checkout.session.expired":
        session_id = session.get("id")
        if session_id:
            await supabase.admin_patch(
                "reader_support_contributions",
                {
                    "stripe_checkout_session_id": f"eq.{session_id}",
                    "status": "eq.pending",
                },
                {"status": "expired"},
            )
    return {"received": True}
