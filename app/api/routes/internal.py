import secrets

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.config import settings
from app.api.deps import supabase

router = APIRouter()


async def verify_scheduler_secret(
    authorization: str | None = Header(default=None),
):
    expected = settings.scheduler_secret

    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Scheduler is not configured.",
        )

    supplied = authorization or ""

    if not supplied.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid scheduler credentials.",
        )

    token = supplied.removeprefix("Bearer ").strip()

    if not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=401,
            detail="Invalid scheduler credentials.",
        )


@router.post(
    "/internal/publish-due-author-notes",
    dependencies=[Depends(verify_scheduler_secret)],
)
async def publish_due_author_notes():
    return await supabase.admin_rpc(
        "publish_due_author_notes",
        {"p_limit": 100},
    )


@router.post("/internal/publish-due-episodes", dependencies=[Depends(verify_scheduler_secret)])
async def publish_due_episodes():
    return await supabase.admin_rpc("publish_due_episodes", {"p_limit": 100})
