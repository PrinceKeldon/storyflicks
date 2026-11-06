
from typing import Any, Literal
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


class ReactionSubmission(BaseModel):
    reaction_codes: list[str] = Field(default_factory=list, max_length=8)


class ReviewSubmission(BaseModel):
    headline: str | None = Field(default=None, max_length=300)
    body: str = Field(min_length=1)
    visibility: Literal["public", "private"] = "public"


class ReadingProgressSubmission(BaseModel):
    progress_percent: float = Field(ge=0, le=100)
    last_position: dict[str, Any] | None = None


async def get_episode_and_story(episode_id: str):
    episodes = await supabase.admin_get(
        "episodes",
        {
            "select": "id,story_id,sequence_number,title,synopsis,content,publication_status,published_at",
            "id": f"eq.{episode_id}",
            "limit": "1",
        },
    )

    if not episodes:
        raise HTTPException(status_code=404, detail="Episode not found.")

    episode = episodes[0]

    stories = await supabase.admin_get(
        "stories",
        {
            "select": "id,slug,title,publication_status,first_episode_free",
            "id": f"eq.{episode['story_id']}",
            "limit": "1",
        },
    )

    if not stories:
        raise HTTPException(status_code=404, detail="Story not found.")

    return episode, stories[0]


async def reader_can_access(user_id: str, episode: dict, story: dict) -> bool:
    if (
        story["publication_status"] != "published"
        or episode["publication_status"] != "published"
    ):
        return False

    if episode["sequence_number"] == 1 and story.get("first_episode_free"):
        return True

    entitlements = await supabase.admin_get(
        "episode_entitlements",
        {
            "select": "id",
            "user_id": f"eq.{user_id}",
            "episode_id": f"eq.{episode['id']}",
            "limit": "1",
        },
    )

    return bool(entitlements)


@router.get("/episodes/{episode_id}")
async def read_episode(
    episode_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    episode, story = await get_episode_and_story(episode_id)

    if not await reader_can_access(user.id, episode, story):
        raise HTTPException(
            status_code=403,
            detail="This episode is not currently available to your account.",
        )

    progress_records = await supabase.admin_get(
        "reading_progress",
        {
            "select": (
                "progress_percent,last_position,"
                "started_at,completed_at,updated_at"
            ),
            "user_id": f"eq.{user.id}",
            "episode_id": f"eq.{episode_id}",
            "limit": "1",
        },
    )

    reading_progress = progress_records[0] if progress_records else None

    return {
        "story": {
            "id": story["id"],
            "slug": story["slug"],
            "title": story["title"],
        },
        "episode": {
            "id": episode["id"],
            "sequence_number": episode["sequence_number"],
            "title": episode["title"],
            "synopsis": episode.get("synopsis"),
            "content": episode["content"],
        },
        "reading_progress": reading_progress,
    }


@router.put("/episodes/{episode_id}/progress")
async def save_reading_progress(
    episode_id: str,
    submission: ReadingProgressSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    episode, story = await get_episode_and_story(episode_id)

    if not await reader_can_access(user.id, episode, story):
        raise HTTPException(
            status_code=403,
            detail="You cannot save progress for an episode you cannot access.",
        )

    return await supabase.user_rpc(
        "save_reading_progress",
        {
            "p_episode_id": episode_id,
            "p_progress_percent": submission.progress_percent,
            "p_last_position": submission.last_position,
        },
        user.access_token,
    )


@router.post("/episodes/{episode_id}/reactions")
async def submit_reactions(
    episode_id: str,
    submission: ReactionSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    episode, story = await get_episode_and_story(episode_id)

    if not await reader_can_access(user.id, episode, story):
        raise HTTPException(
            status_code=403,
            detail="You cannot contribute to an episode you cannot access.",
        )

    return await supabase.user_rpc(
        "submit_episode_reactions",
        {
            "p_episode_id": episode_id,
            "p_reaction_codes": submission.reaction_codes,
        },
        user.access_token,
    )


@router.post("/episodes/{episode_id}/reviews")
async def submit_review(
    episode_id: str,
    submission: ReviewSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    episode, story = await get_episode_and_story(episode_id)

    if not await reader_can_access(user.id, episode, story):
        raise HTTPException(
            status_code=403,
            detail="You cannot review an episode you cannot access.",
        )

    if not submission.body.strip():
        raise HTTPException(
            status_code=422,
            detail="Review text cannot be empty.",
        )

    return await supabase.user_rpc(
        "submit_episode_review",
        {
            "p_episode_id": episode_id,
            "p_headline": submission.headline,
            "p_body": submission.body,
            "p_visibility": submission.visibility,
        },
        user.access_token,
    )


@router.get("/episodes/{episode_id}/review-room")
async def get_review_room(
    episode_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    episode, story = await get_episode_and_story(episode_id)

    if not await reader_can_access(user.id, episode, story):
        raise HTTPException(
            status_code=403,
            detail="You cannot view the Review Room for an episode you cannot access.",
        )

    reviews = await supabase.admin_get(
        "reviews",
        {
            "select": "id,user_id,episode_id,headline,body,submitted_at,created_at",
            "episode_id": f"eq.{episode_id}",
            "status": "eq.submitted",
            "visibility": "eq.public",
            "order": "submitted_at.desc",
        },
    )

    definitions = await supabase.admin_get(
        "reaction_definitions",
        {
            "select": "id,code,statement,emoji,category,sort_order",
            "is_active": "eq.true",
            "order": "sort_order.asc",
        },
    )

    reader_reactions = await supabase.admin_get(
        "reader_reactions",
        {
            "select": "user_id,reaction_id",
            "episode_id": f"eq.{episode_id}",
        },
    )

    reaction_counts = defaultdict(int)
    my_reactions = set()

    for reaction in reader_reactions:
        reaction_counts[reaction["reaction_id"]] += 1
        if reaction["user_id"] == user.id:
            my_reactions.add(reaction["reaction_id"])

    reaction_summary = [
        {
            **definition,
            "count": reaction_counts[definition["id"]],
            "selected_by_me": definition["id"] in my_reactions,
        }
        for definition in definitions
    ]

    review_ids = [review["id"] for review in reviews]

    helpful_counts = defaultdict(int)
    my_helpful_votes = set()
    author_replies = []
    profiles = []

    if review_ids:
        review_filter = f"in.({','.join(review_ids)})"

        votes = await supabase.admin_get(
            "review_helpful_votes",
            {
                "select": "user_id,review_id",
                "review_id": review_filter,
            },
        )

        for vote in votes:
            helpful_counts[vote["review_id"]] += 1
            if vote["user_id"] == user.id:
                my_helpful_votes.add(vote["review_id"])

        author_replies = await supabase.admin_get(
            "author_replies",
            {
                "select": "id,review_id,creator_id,body,created_at",
                "review_id": review_filter,
                "status": "eq.published",
                "order": "created_at.asc",
            },
        )

        profile_ids = {
            review["user_id"] for review in reviews
        } | {
            reply["creator_id"] for reply in author_replies
        }

        if profile_ids:
            profiles = await supabase.admin_get(
                "profiles",
                {
                    "select": "id,username,display_name,avatar_path",
                    "id": f"in.({','.join(profile_ids)})",
                },
            )

    profile_map = {
        profile["id"]: profile
        for profile in profiles
    }

    reply_map = {
        reply["review_id"]: {
            "id": reply["id"],
            "body": reply["body"],
            "created_at": reply["created_at"],
            "creator": profile_map.get(reply["creator_id"]),
        }
        for reply in author_replies
    }

    review_results = []

    for review in reviews:
        review_results.append({
            **review,
            "author": profile_map.get(review["user_id"]),
            "helpful_count": helpful_counts[review["id"]],
            "helpful_by_me": review["id"] in my_helpful_votes,
            "author_reply": reply_map.get(review["id"]),
        })

    return {
        "episode": {
            "id": episode["id"],
            "title": episode["title"],
            "sequence_number": episode["sequence_number"],
        },
        "reaction_summary": reaction_summary,
        "reviews": review_results,
        "review_count": len(review_results),
    }
