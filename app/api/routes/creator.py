from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


class ModerationDecision(BaseModel):
    decision: Literal["reviewed", "resolved", "dismissed"]
    hide_content: bool = False


@router.get("/creator/moderation/reports")
async def get_moderation_reports(
    status: Literal[
        "all", "pending", "reviewed", "resolved", "dismissed"
    ] = "pending",
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "get_creator_moderation_queue",
        {"p_status": status},
        user.access_token,
    )


@router.patch("/creator/moderation/reports/{report_id}")
async def moderate_report(
    report_id: UUID,
    submission: ModerationDecision,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "moderate_content_report",
        {
            "p_report_id": str(report_id),
            "p_decision": submission.decision,
            "p_hide_content": submission.hide_content,
        },
        user.access_token,
    )


class AuthorReplyWithReviewSubmission(BaseModel):
    review_id: UUID
    body: str


@router.post("/creator/reviews/reply")
async def publish_author_reply(
    submission: AuthorReplyWithReviewSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "publish_author_reply",
        {
            "p_review_id": str(submission.review_id),
            "p_body": submission.body,
        },
        user.access_token,
    )


class AuthorNoteSubmission(BaseModel):
    story_id: UUID
    body: str
    action: Literal["draft", "publish", "schedule", "withdraw"]
    note_id: UUID | None = None
    episode_id: UUID | None = None
    title: str | None = None
    scheduled_at: datetime | None = None


@router.post("/creator/author-notes")
async def save_author_note(
    submission: AuthorNoteSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_author_note",
        {
            "p_story_id": str(submission.story_id),
            "p_body": submission.body,
            "p_action": submission.action,
            "p_note_id": str(submission.note_id) if submission.note_id else None,
            "p_episode_id": str(submission.episode_id) if submission.episode_id else None,
            "p_title": submission.title,
            "p_scheduled_at": (
                submission.scheduled_at.isoformat()
                if submission.scheduled_at else None
            ),
        },
        user.access_token,
    )


@router.get("/creator/author-notes")
async def get_author_notes(
    story_id: UUID | None = None,
    status: Literal["all", "draft", "scheduled", "published", "withdrawn"] = "all",
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "get_creator_author_notes",
        {
            "p_story_id": str(story_id) if story_id else None,
            "p_status": status,
        },
        user.access_token,
    )


class AuthorNotePinSubmission(BaseModel):
    is_pinned: bool


@router.patch("/creator/author-notes/{note_id}/pin")
async def set_author_note_pin(
    note_id: UUID,
    submission: AuthorNotePinSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "set_author_note_pinned",
        {
            "p_note_id": str(note_id),
            "p_is_pinned": submission.is_pinned,
        },
        user.access_token,
    )


class AuthorReplyBodySubmission(BaseModel):
    body: str


@router.post("/creator/reviews/{review_id}/reply")
async def publish_author_reply(
    review_id: UUID,
    submission: AuthorReplyBodySubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "publish_author_reply",
        {
            "p_review_id": str(review_id),
            "p_body": submission.body,
        },
        user.access_token,
    )


# =========================================================
# CREATOR STORY AND EPISODE MANAGEMENT
# =========================================================

class CreatorStorySubmission(BaseModel):
    title: str
    slug: str
    tagline: str | None = None
    synopsis: str | None = None
    first_episode_free: bool = True


class CreatorEpisodeSubmission(BaseModel):
    season_id: UUID | None = None
    sequence_number: int
    title: str
    synopsis: str | None = None
    content: dict[str, Any]


@router.post("/creator/stories")
async def create_creator_story(
    submission: CreatorStorySubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_creator_story",
        {
            "p_story_id": None,
            "p_title": submission.title,
            "p_slug": submission.slug,
            "p_tagline": submission.tagline,
            "p_synopsis": submission.synopsis,
            "p_first_episode_free": submission.first_episode_free,
        },
        user.access_token,
    )


@router.put("/creator/stories/{story_id}")
async def update_creator_story(
    story_id: UUID,
    submission: CreatorStorySubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_creator_story",
        {
            "p_story_id": str(story_id),
            "p_title": submission.title,
            "p_slug": submission.slug,
            "p_tagline": submission.tagline,
            "p_synopsis": submission.synopsis,
            "p_first_episode_free": submission.first_episode_free,
        },
        user.access_token,
    )


@router.post("/creator/stories/{story_id}/episodes")
async def create_creator_episode(
    story_id: UUID,
    submission: CreatorEpisodeSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_creator_episode",
        {
            "p_episode_id": None,
            "p_story_id": str(story_id),
            "p_season_id": (
                str(submission.season_id)
                if submission.season_id else None
            ),
            "p_sequence_number": submission.sequence_number,
            "p_title": submission.title,
            "p_synopsis": submission.synopsis,
            "p_content": submission.content,
        },
        user.access_token,
    )


@router.put("/creator/stories/{story_id}/episodes/{episode_id}")
async def update_creator_episode(
    story_id: UUID,
    episode_id: UUID,
    submission: CreatorEpisodeSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_creator_episode",
        {
            "p_episode_id": str(episode_id),
            "p_story_id": str(story_id),
            "p_season_id": (
                str(submission.season_id)
                if submission.season_id else None
            ),
            "p_sequence_number": submission.sequence_number,
            "p_title": submission.title,
            "p_synopsis": submission.synopsis,
            "p_content": submission.content,
        },
        user.access_token,
    )


# =========================================================
# CREATOR STORY WORKSPACE
# =========================================================

@router.get("/creator/stories/{story_id}/workspace")
async def get_creator_story_workspace(
    story_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "get_creator_story_workspace",
        {"p_story_id": str(story_id)},
        user.access_token,
    )


# =========================================================
# CREATOR EPISODE PUBLICATION
# =========================================================

class CreatorEpisodePublicationSubmission(BaseModel):
    action: Literal["publish", "schedule", "cancel_schedule"]
    revision_id: UUID | None = None
    scheduled_at: datetime | None = None


@router.post("/creator/episodes/{episode_id}/publication")
async def publish_creator_episode(
    episode_id: UUID,
    submission: CreatorEpisodePublicationSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    if submission.action in ("publish", "schedule") and submission.revision_id is None:
        raise HTTPException(
            status_code=422,
            detail="A revision_id is required to publish or schedule an episode.",
        )

    if submission.action == "schedule" and submission.scheduled_at is None:
        raise HTTPException(
            status_code=422,
            detail="A scheduled_at date and time is required.",
        )

    return await supabase.user_rpc(
        "publish_creator_episode",
        {
            "p_episode_id": str(episode_id),
            "p_revision_id": (
                str(submission.revision_id)
                if submission.revision_id else None
            ),
            "p_action": submission.action,
            "p_scheduled_at": (
                submission.scheduled_at.isoformat()
                if submission.scheduled_at else None
            ),
        },
        user.access_token,
    )


# =========================================================
# CREATOR STORY PUBLICATION
# =========================================================

@router.post("/creator/stories/{story_id}/publish")
async def publish_creator_story(
    story_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "publish_creator_story",
        {"p_story_id": str(story_id)},
        user.access_token,
    )


class CreatorStoryCompletionSubmission(BaseModel):
    completion_status: Literal["ongoing", "completed"]


@router.patch("/creator/stories/{story_id}/completion-status")
async def set_creator_story_completion_status(
    story_id: UUID,
    submission: CreatorStoryCompletionSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "set_creator_story_completion_status",
        {
            "p_story_id": str(story_id),
            "p_completion_status": submission.completion_status,
        },
        user.access_token,
    )
