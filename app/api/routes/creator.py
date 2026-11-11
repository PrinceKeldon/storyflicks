from datetime import datetime
import json
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser
from app.api.routes.creator_assets import require_story_editor

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


@router.get("/creator/reviews")
async def get_creator_public_reviews(
    story_id: UUID | None = None,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Return public submitted reviews for stories assigned to this creator.

    Private reviews are deliberately excluded from this creator-facing feed.
    """
    creator_profiles = await supabase.admin_get(
        "creator_profiles",
        {"id": f"eq.{user.id}", "status": "eq.active", "limit": "1"},
    )
    if not creator_profiles:
        raise HTTPException(403, "An active creator profile is required.")

    assignment_filters = {"creator_id": f"eq.{user.id}"}
    if story_id:
        assignment_filters["story_id"] = f"eq.{story_id}"
    assignments = await supabase.admin_get("story_creators", assignment_filters)
    assigned_story_ids = [
        item["story_id"] for item in assignments
        if item.get("role") in ("owner", "author", "editor")
    ]
    if not assigned_story_ids:
        return {"reviews": []}

    story_filter = f"in.({','.join(assigned_story_ids)})"
    stories = await supabase.admin_get(
        "stories", {"id": story_filter, "select": "id,title,slug"}
    )
    episodes = await supabase.admin_get(
        "episodes",
        {"story_id": story_filter, "select": "id,story_id,title,sequence_number"},
    )
    if not episodes:
        return {"reviews": []}

    episode_ids = [item["id"] for item in episodes]
    episode_filter = f"in.({','.join(episode_ids)})"
    reviews = await supabase.admin_get(
        "reviews",
        {
            "episode_id": episode_filter,
            "status": "eq.submitted",
            "visibility": "eq.public",
            "select": "id,user_id,episode_id,headline,body,submitted_at,created_at",
            "order": "submitted_at.desc",
            "limit": "100",
        },
    )
    if not reviews:
        return {"reviews": []}

    review_ids = [item["id"] for item in reviews]
    review_filter = f"in.({','.join(review_ids)})"
    replies = await supabase.admin_get(
        "author_replies",
        {
            "review_id": review_filter,
            "status": "eq.published",
            "select": "id,review_id,creator_id,body,created_at",
            "order": "created_at.asc",
        },
    )
    profile_ids = list({item["user_id"] for item in reviews} | {item["creator_id"] for item in replies})
    profiles = await supabase.admin_get(
        "profiles",
        {"id": f"in.({','.join(profile_ids)})", "select": "id,username,display_name,avatar_path"},
    ) if profile_ids else []
    profile_map = {item["id"]: item for item in profiles}
    episode_map = {item["id"]: item for item in episodes}
    story_map = {item["id"]: item for item in stories}
    reply_map: dict[str, list[dict[str, Any]]] = {}
    for reply in replies:
        reply_map.setdefault(reply["review_id"], []).append({
            "id": reply["id"],
            "body": reply["body"],
            "created_at": reply["created_at"],
            "creator": profile_map.get(reply["creator_id"]),
        })

    return {
        "reviews": [
            {
                **review,
                "reader": profile_map.get(review["user_id"]),
                "episode": episode_map.get(review["episode_id"]),
                "story": story_map.get(episode_map.get(review["episode_id"], {}).get("story_id")),
                "author_replies": reply_map.get(review["id"], []),
            }
            for review in reviews
            if review["episode_id"] in episode_map
        ]
    }


class AuthorReplyWithReviewSubmission(BaseModel):
    review_id: UUID
    body: str = Field(min_length=1, max_length=10000)


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
    body: str = Field(min_length=1, max_length=50000)
    action: Literal["draft", "publish", "schedule", "withdraw"]
    note_id: UUID | None = None
    episode_id: UUID | None = None
    title: str | None = Field(default=None, max_length=200)
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
    body: str = Field(min_length=1, max_length=10000)


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
    title: str = Field(min_length=1, max_length=160)
    author_name: str | None = Field(default=None, max_length=160)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    tagline: str | None = Field(default=None, max_length=240)
    synopsis: str | None = Field(default=None, max_length=10000)
    first_episode_free: bool = True
    genres: list[str] = Field(default_factory=list, max_length=5)
    section_label: str = Field(default="Episode", min_length=1, max_length=32)
    section_label_plural: str = Field(default="Episodes", min_length=1, max_length=40)

    @field_validator("section_label", "section_label_plural")
    @classmethod
    def validate_section_label(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or not all(character.isalnum() or character in " &\'-" for character in normalized):
            raise ValueError("Section labels may contain letters, numbers, spaces, ampersands, apostrophes and hyphens only.")
        return normalized


class CreatorEpisodeSubmission(BaseModel):
    season_id: UUID | None = None
    sequence_number: int = Field(ge=1, le=100000)
    title: str = Field(min_length=1, max_length=200)
    synopsis: str | None = Field(default=None, max_length=10000)
    content: dict[str, Any]

    @field_validator("content")
    @classmethod
    def validate_content_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ValueError("Episode content must be valid JSON.") from exc
        if len(encoded) > 2 * 1024 * 1024:
            raise ValueError("Episode content must be 2 MB or smaller.")
        blocks = value.get("blocks")
        if blocks is not None:
            if not isinstance(blocks, list) or len(blocks) > 2000:
                raise ValueError("An episode can contain at most 2,000 content blocks.")
            for block in blocks:
                if not isinstance(block, dict):
                    raise ValueError("Each episode content block must be an object.")
                block_type = block.get("type")
                if not isinstance(block_type, str) or not block_type.strip() or len(block_type) > 50:
                    raise ValueError("Each content block must retain a non-empty block type of 50 characters or fewer.")
                if not isinstance(block.get("text"), str) or len(block["text"]) > 100000:
                    raise ValueError("Each content block must contain text of 100,000 characters or fewer.")
                runs = block.get("runs")
                if runs is not None:
                    if not isinstance(runs, list) or len(runs) > 10000:
                        raise ValueError("Each paragraph can contain at most 10,000 inline runs.")
                    for run in runs:
                        if not isinstance(run, dict) or not isinstance(run.get("text"), str) or len(run["text"]) > 100000:
                            raise ValueError("Inline formatting runs must contain text of 100,000 characters or fewer.")
        return value


@router.post("/creator/stories")
async def create_creator_story(
    submission: CreatorStorySubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_creator_story_v4",
        {
            "p_story_id": None,
            "p_title": submission.title,
            "p_author_name": submission.author_name,
            "p_slug": submission.slug,
            "p_tagline": submission.tagline,
            "p_synopsis": submission.synopsis,
            "p_first_episode_free": submission.first_episode_free,
            "p_genres": submission.genres,
            "p_section_label": submission.section_label,
            "p_section_label_plural": submission.section_label_plural,
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
        "save_creator_story_v4",
        {
            "p_story_id": str(story_id),
            "p_title": submission.title,
            "p_author_name": submission.author_name,
            "p_slug": submission.slug,
            "p_tagline": submission.tagline,
            "p_synopsis": submission.synopsis,
            "p_first_episode_free": submission.first_episode_free,
            "p_genres": submission.genres,
            "p_section_label": submission.section_label,
            "p_section_label_plural": submission.section_label_plural,
        },
        user.access_token,
    )


class CreatorEpisodeTitleSubmission(BaseModel):
    title: str = Field(min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("A chapter title is required.")
        return title


@router.patch("/creator/stories/{story_id}/episodes/{episode_id}/title")
async def update_creator_episode_title(
    story_id: UUID,
    episode_id: UUID,
    submission: CreatorEpisodeTitleSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)
    episodes = await supabase.admin_get(
        "episodes",
        {
            "id": f"eq.{episode_id}",
            "story_id": f"eq.{story_id}",
            "deleted_at": "is.null",
            "select": "id",
            "limit": "1",
        },
    )
    if not episodes:
        raise HTTPException(404, "Chapter not found in this story.")
    await supabase.admin_patch(
        "episodes",
        {"id": f"eq.{episode_id}", "story_id": f"eq.{story_id}"},
        {"title": submission.title},
    )
    return {"episode_id": str(episode_id), "title": submission.title}



class CreatorEpisodeSynopsisSubmission(BaseModel):
    synopsis: str | None = Field(default=None, max_length=10000)


@router.patch("/creator/stories/{story_id}/episodes/{episode_id}/synopsis")
async def save_creator_episode_synopsis(
    story_id: UUID,
    episode_id: UUID,
    submission: CreatorEpisodeSynopsisSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)
    episodes = await supabase.admin_get(
        "episodes",
        {
            "id": f"eq.{episode_id}",
            "story_id": f"eq.{story_id}",
            "deleted_at": "is.null",
            "select": "id",
            "limit": "1",
        },
    )
    if not episodes:
        raise HTTPException(404, "Section not found in this story.")

    synopsis = submission.synopsis.strip() if submission.synopsis else None
    await supabase.admin_patch(
        "episodes",
        {"id": f"eq.{episode_id}", "story_id": f"eq.{story_id}"},
        {"synopsis": synopsis, "updated_at": datetime.now(timezone.utc).isoformat()},
    )
    # Keep the latest editable draft's metadata aligned without creating a
    # manuscript revision or changing any published revision.
    drafts = await supabase.admin_get(
        "episode_revisions",
        {
            "episode_id": f"eq.{episode_id}",
            "revision_status": "eq.draft",
            "select": "id",
            "order": "revision_number.desc",
            "limit": "1",
        },
    )
    if drafts:
        await supabase.admin_patch(
            "episode_revisions",
            {"id": f"eq.{drafts[0]['id']}", "episode_id": f"eq.{episode_id}"},
            {"synopsis": synopsis},
        )
    return {"episode_id": str(episode_id), "synopsis": synopsis}


@router.post("/creator/stories/{story_id}/episodes")
async def create_creator_episode(
    story_id: UUID,
    submission: CreatorEpisodeSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    conflicts = await supabase.admin_get(
        "episodes",
        {"story_id": f"eq.{story_id}", "sequence_number": f"eq.{submission.sequence_number}",
         "deleted_at": "is.null", "select": "id,title", "limit": "1"},
    )
    if conflicts:
        raise HTTPException(409, f"Chapter number {submission.sequence_number} is already used by “{conflicts[0]['title']}”. Select that chapter to revise it, or choose an unused number.")
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
    conflicts = await supabase.admin_get(
        "episodes",
        {"story_id": f"eq.{story_id}", "sequence_number": f"eq.{submission.sequence_number}",
         "id": f"neq.{episode_id}", "deleted_at": "is.null", "select": "id,title", "limit": "1"},
    )
    if conflicts:
        raise HTTPException(409, f"Chapter number {submission.sequence_number} is already used by “{conflicts[0]['title']}”. Choose an unused number.")
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
