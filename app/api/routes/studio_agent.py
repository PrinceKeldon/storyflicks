"""Creator Studio assistant: chat, and approval of the edits it proposes."""

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, supabase
from app.api.routes.creator_assets import require_story_editor
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.services import agent_edits, agent_tools
from app.services.agent_loop import run_agent

router = APIRouter()

MAX_CONTENT_BYTES = 2 * 1024 * 1024
MAX_BLOCKS = 2000


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None
    story_id: UUID | None = None


async def _require_active_creator(user: AuthenticatedUser) -> None:
    rows = await supabase.admin_get(
        "creator_profiles", {"id": f"eq.{user.id}", "status": "eq.active", "select": "id", "limit": "1"}
    )
    if not rows:
        raise HTTPException(403, "An active creator profile is required.")


async def _own_conversation(conversation_id: UUID, user: AuthenticatedUser) -> dict:
    rows = await supabase.admin_get(
        "studio_agent_conversations",
        {"id": f"eq.{conversation_id}", "creator_id": f"eq.{user.id}", "select": "*", "limit": "1"},
    )
    if not rows:
        raise HTTPException(404, "Conversation not found.")
    return rows[0]


def _public_proposal(row: dict) -> dict:
    return {key: row.get(key) for key in (
        "id", "conversation_id", "story_id", "episode_id", "kind", "status", "title",
        "rationale", "payload", "applied_revision_id", "error", "created_at", "decided_at",
    )}


@router.post("/creator/agent/chat")
async def agent_chat(body: AgentChatRequest, user: AuthenticatedUser = Depends(get_current_user)):
    await _require_active_creator(user)

    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    limit = settings.agent_daily_message_limit
    recent = await supabase.admin_get(
        "studio_agent_messages",
        {"creator_id": f"eq.{user.id}", "role": "eq.user", "created_at": f"gte.{since}",
         "select": "id", "limit": str(limit)},
    )
    if len(recent) >= limit:
        raise HTTPException(429, "You have reached today's limit for assistant messages. Try again tomorrow.")

    story_id = str(body.story_id) if body.story_id else None
    history: list[dict] = []
    if body.conversation_id:
        conversation = await _own_conversation(body.conversation_id, user)
        conversation_id = conversation["id"]
        story_id = story_id or conversation.get("story_id")
        history = await supabase.admin_get(
            "studio_agent_messages",
            {"conversation_id": f"eq.{conversation_id}", "select": "role,content",
             "order": "created_at.desc", "limit": "24"},
        )
        history.reverse()
        is_new = False
    else:
        conversation_id = str(uuid4())
        is_new = True

    ctx = agent_tools.AgentContext(user=user, conversation_id=conversation_id, story_id=None)
    if story_id:
        try:
            ctx.story_id = await ctx.require_story(story_id)
        except agent_tools.ToolError:
            raise HTTPException(403, "You do not have access to that story.") from None

    if is_new:
        await supabase.admin_insert("studio_agent_conversations", {
            "id": conversation_id, "creator_id": user.id, "story_id": ctx.story_id,
            "title": body.message.strip()[:80],
        })

    reply, model = await run_agent(ctx, history, body.message)

    now = datetime.now(timezone.utc)
    await supabase.admin_insert("studio_agent_messages", {
        "conversation_id": conversation_id, "creator_id": user.id, "role": "user",
        "content": body.message, "created_at": now.isoformat(),
    })
    await supabase.admin_insert("studio_agent_messages", {
        "conversation_id": conversation_id, "creator_id": user.id, "role": "model",
        "content": reply[:20000], "tool_activity": ctx.activity, "sources": ctx.sources,
        "created_at": (now + timedelta(milliseconds=1)).isoformat(),
    })
    await supabase.admin_patch(
        "studio_agent_conversations",
        {"id": f"eq.{conversation_id}", "creator_id": f"eq.{user.id}"},
        {"updated_at": now.isoformat()},
    )
    return {
        "conversation_id": conversation_id,
        "reply": reply,
        "tool_activity": ctx.activity,
        "sources": ctx.sources,
        "proposals": [_public_proposal(p) for p in ctx.proposals],
        "model": model,
    }


@router.get("/creator/agent/conversations")
async def list_conversations(user: AuthenticatedUser = Depends(get_current_user)):
    rows = await supabase.admin_get(
        "studio_agent_conversations",
        {"creator_id": f"eq.{user.id}", "select": "id,title,story_id,updated_at",
         "order": "updated_at.desc", "limit": "30"},
    )
    return {"conversations": rows}


@router.get("/creator/agent/conversations/{conversation_id}")
async def get_conversation(conversation_id: UUID, user: AuthenticatedUser = Depends(get_current_user)):
    conversation = await _own_conversation(conversation_id, user)
    messages = await supabase.admin_get(
        "studio_agent_messages",
        {"conversation_id": f"eq.{conversation_id}", "creator_id": f"eq.{user.id}",
         "select": "id,role,content,tool_activity,sources,created_at", "order": "created_at.asc", "limit": "200"},
    )
    proposals = await supabase.admin_get(
        "studio_agent_proposals",
        {"conversation_id": f"eq.{conversation_id}", "creator_id": f"eq.{user.id}",
         "select": "*", "order": "created_at.asc", "limit": "100"},
    )
    return {"conversation": conversation, "messages": messages,
            "proposals": [_public_proposal(p) for p in proposals]}


@router.get("/creator/agent/proposals")
async def list_proposals(status: str = "pending", user: AuthenticatedUser = Depends(get_current_user)):
    if status not in {"pending", "applied", "rejected", "stale", "failed"}:
        raise HTTPException(422, "Unknown status.")
    rows = await supabase.admin_get(
        "studio_agent_proposals",
        {"creator_id": f"eq.{user.id}", "status": f"eq.{status}", "select": "*",
         "order": "created_at.desc", "limit": "50"},
    )
    return {"proposals": [_public_proposal(r) for r in rows]}


async def _own_proposal(proposal_id: UUID, user: AuthenticatedUser) -> dict:
    rows = await supabase.admin_get(
        "studio_agent_proposals",
        {"id": f"eq.{proposal_id}", "creator_id": f"eq.{user.id}", "select": "*", "limit": "1"},
    )
    if not rows:
        raise HTTPException(404, "Proposal not found.")
    return rows[0]


async def _finish(proposal_id: str, status: str, **extra) -> None:
    await supabase.admin_patch(
        "studio_agent_proposals",
        {"id": f"eq.{proposal_id}"},
        {"status": status, "decided_at": datetime.now(timezone.utc).isoformat(), **extra},
    )


@router.post("/creator/agent/proposals/{proposal_id}/approve")
async def approve_proposal(proposal_id: UUID, user: AuthenticatedUser = Depends(get_current_user)):
    proposal = await _own_proposal(proposal_id, user)
    if proposal["status"] != "pending":
        raise HTTPException(409, f"This proposal is already {proposal['status']}.")
    await require_story_editor(UUID(proposal["story_id"]), user)

    # Claim it atomically so a double click cannot apply the edits twice.
    claimed = await supabase.admin_patch_returning(
        "studio_agent_proposals",
        {"id": f"eq.{proposal_id}", "creator_id": f"eq.{user.id}", "status": "eq.pending"},
        {"status": "applying"},
    )
    if not claimed:
        raise HTTPException(409, "This proposal was already handled.")

    pid = str(proposal_id)
    payload = proposal.get("payload") or {}
    try:
        episodes = await supabase.admin_get(
            "episodes",
            {"id": f"eq.{proposal['episode_id']}", "deleted_at": "is.null",
             "select": "id,story_id,season_id,sequence_number,title", "limit": "1"},
        )
        revisions = await supabase.admin_get(
            "episode_revisions",
            {"episode_id": f"eq.{proposal['episode_id']}",
             "select": "id,title,synopsis,content", "order": "revision_number.desc", "limit": "1"},
        )
        if not episodes or not revisions:
            await _finish(pid, "failed", error="The chapter no longer exists.")
            raise HTTPException(409, "The chapter no longer exists.")
        episode, latest = episodes[0], revisions[0]

        if (latest["id"] != payload.get("base_revision_id")
                or agent_edits.content_hash(latest["content"]) != payload.get("base_hash")):
            await _finish(pid, "stale", error="The chapter changed after this was proposed.")
            raise HTTPException(
                409,
                "The chapter has changed since this edit was proposed, so it was not applied. Ask the assistant to propose it again.",
            )

        try:
            new_content = agent_edits.apply_edits(latest["content"], payload.get("edits") or [])
        except agent_edits.EditError as exc:
            await _finish(pid, "failed", error=str(exc)[:900])
            raise HTTPException(409, f"The edits could not be applied: {exc}") from exc

        blocks = agent_edits.content_blocks(new_content)
        if len(blocks) > MAX_BLOCKS or len(json.dumps(new_content, ensure_ascii=False).encode()) > MAX_CONTENT_BYTES:
            await _finish(pid, "failed", error="The edited chapter would exceed the size limit.")
            raise HTTPException(413, "The edited chapter would exceed the size limit.")

        await supabase.user_rpc(
            "save_creator_episode",
            {
                "p_episode_id": episode["id"],
                "p_story_id": episode["story_id"],
                "p_season_id": episode.get("season_id"),
                "p_sequence_number": episode["sequence_number"],
                "p_title": latest.get("title") or episode["title"],
                "p_synopsis": latest.get("synopsis"),
                "p_content": new_content,
            },
            user.access_token,
        )
        saved = await supabase.admin_get(
            "episode_revisions",
            {"episode_id": f"eq.{episode['id']}", "select": "id", "order": "revision_number.desc", "limit": "1"},
        )
        await _finish(pid, "applied", applied_revision_id=saved[0]["id"] if saved else None)
    except HTTPException as exc:
        if exc.status_code not in (409, 413):
            await _finish(pid, "failed", error=str(exc.detail)[:900])
        raise
    except Exception:
        await _finish(pid, "failed", error="Unexpected error while saving.")
        raise

    return {
        "status": "applied",
        "message": "Saved as a new draft revision. If the chapter is published, readers still see the published text until you publish this revision.",
        "applied_revision_id": saved[0]["id"] if saved else None,
    }


@router.post("/creator/agent/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: UUID, user: AuthenticatedUser = Depends(get_current_user)):
    await _own_proposal(proposal_id, user)
    rows = await supabase.admin_patch_returning(
        "studio_agent_proposals",
        {"id": f"eq.{proposal_id}", "creator_id": f"eq.{user.id}", "status": "eq.pending"},
        {"status": "rejected", "decided_at": datetime.now(timezone.utc).isoformat()},
    )
    if not rows:
        raise HTTPException(409, "This proposal was already handled.")
    return {"status": "rejected"}
