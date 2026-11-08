from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser
from app.services.storage import public_storage_url

router = APIRouter()


def in_filter(values: set[str]) -> str:
    return f"in.({','.join(sorted(values))})"


@router.get("/library")
async def get_library(
    user: AuthenticatedUser = Depends(get_current_user),
):
    # Every query is scoped to the authenticated reader.
    bookmarks = await supabase.admin_get(
        "bookmarks",
        {
            "select": "story_id,created_at",
            "user_id": f"eq.{user.id}",
            "order": "created_at.desc",
        },
    )

    progress = await supabase.admin_get(
        "reading_progress",
        {
            "select": (
                "episode_id,progress_percent,last_position,"
                "started_at,completed_at,updated_at"
            ),
            "user_id": f"eq.{user.id}",
            "order": "updated_at.desc",
        },
    )

    entitlements = await supabase.admin_get(
        "episode_entitlements",
        {
            "select": "episode_id,grant_reason,source_episode_id,granted_at",
            "user_id": f"eq.{user.id}",
            "order": "granted_at.desc",
        },
    )

    reactions = await supabase.admin_get(
        "reader_reactions",
        {
            "select": "id,episode_id,reaction_id,created_at",
            "user_id": f"eq.{user.id}",
            "order": "created_at.desc",
        },
    )

    reviews = await supabase.admin_get(
        "reviews",
        {
            "select": (
                "id,episode_id,headline,body,visibility,"
                "status,submitted_at,created_at,updated_at"
            ),
            "user_id": f"eq.{user.id}",
            "status": "eq.submitted",
            "order": "submitted_at.desc",
        },
    )

    # Collect every episode and story relevant to this reader.
    episode_ids = {
        item["episode_id"]
        for item in progress + reactions + reviews
    } | {
        item["episode_id"]
        for item in entitlements
    }

    bookmarked_story_ids = {
        item["story_id"]
        for item in bookmarks
    }

    episodes = []
    if episode_ids:
        episodes = await supabase.admin_get(
            "episodes",
            {
                "select": (
                    "id,story_id,sequence_number,title,"
                    "publication_status,published_at"
                ),
                "id": in_filter(episode_ids),
            },
        )

    episode_map = {item["id"]: item for item in episodes}

    story_ids = bookmarked_story_ids | {
        item["story_id"] for item in episodes
    }

    stories = []
    published_episodes = []

    if story_ids:
        stories = await supabase.admin_get(
            "stories",
            {
                "select": (
                    "id,slug,title,tagline,synopsis,cover_path,"
                    "publication_status,completion_status"
                ),
                "id": in_filter(story_ids),
            },
        )

        published_episodes = await supabase.admin_get(
            "episodes",
            {
                "select": (
                    "id,story_id,sequence_number,title,"
                    "publication_status,published_at"
                ),
                "story_id": in_filter(story_ids),
                "publication_status": "eq.published",
                "order": "sequence_number.asc",
            },
        )

    story_map = {
        item["id"]: {
            **item,
            "cover_url": public_storage_url(item.get("cover_path")),
        }
        for item in stories
    }

    episodes_by_story = defaultdict(list)
    for episode in published_episodes:
        episodes_by_story[episode["story_id"]].append(episode)

    progress_by_story = defaultdict(list)
    for item in progress:
        episode = episode_map.get(item["episode_id"])
        if episode:
            progress_by_story[episode["story_id"]].append(item)

    engaged_story_ids = {
        episode_map[item["episode_id"]]["story_id"]
        for item in reactions + reviews
        if item["episode_id"] in episode_map
    }

    completed_episode_ids = {
        item["episode_id"]
        for item in progress
        if item["completed_at"] is not None
    }

    bookmarked_ids = {
        item["story_id"]
        for item in bookmarks
    }

    # Build story cards and classify reading status.
    continue_reading = []
    not_started = []
    caught_up = []
    completed = []
    saved = []

    for story_id, story in story_map.items():
        if story["publication_status"] != "published":
            continue

        story_episodes = episodes_by_story.get(story_id, [])
        story_progress = progress_by_story.get(story_id, [])

        if not story_episodes:
            continue

        latest_episode = story_episodes[-1]

        completed_all = all(
            episode["id"] in completed_episode_ids
            for episode in story_episodes
        )

        latest_completed = (
            latest_episode["id"] in completed_episode_ids
        )

        # A reader who has reacted or reviewed has started the story,
        # even if a progress checkpoint has not yet been saved.
        has_started = bool(story_progress) or story_id in engaged_story_ids

        last_read = None
        if story_progress:
            most_recent_progress = max(
                story_progress,
                key=lambda item: item.get("updated_at") or "",
            )
            last_read = episode_map.get(most_recent_progress["episode_id"])

        card = {
            "story": story,
            "last_read_episode": last_read,
            "latest_published_episode": latest_episode,
            "first_published_episode": story_episodes[0],
            "published_episode_count": len(story_episodes),
            "completed_episode_count": sum(
                1 for episode in story_episodes
                if episode["id"] in completed_episode_ids
            ),
            "reading_progress": story_progress,
            "available_episode": next(
                (
                    episode_map[item["episode_id"]]
                    for item in entitlements
                    if item["episode_id"] in episode_map
                    and episode_map[item["episode_id"]]["story_id"] == story_id
                    and episode_map[item["episode_id"]]["publication_status"] == "published"
                ),
                None,
            ),
        }

        if story_id in bookmarked_ids:
            saved.append(card)

        if (
            story["completion_status"] == "completed"
            and completed_all
        ):
            completed.append(card)

        elif (
            story["completion_status"] == "ongoing"
            and latest_completed
        ):
            caught_up.append(card)

        elif has_started:
            continue_reading.append(card)

        elif story_id in bookmarked_ids:
            not_started.append(card)

    # Resolve editorial reaction labels and emojis.
    reaction_ids = {
        item["reaction_id"]
        for item in reactions
    }

    definitions = []
    if reaction_ids:
        definitions = await supabase.admin_get(
            "reaction_definitions",
            {
                "select": "id,code,statement,emoji,category,sort_order",
                "id": in_filter(reaction_ids),
            },
        )

    definition_map = {
        item["id"]: item
        for item in definitions
    }

    reaction_contributions = []
    for item in reactions:
        episode = episode_map.get(item["episode_id"])
        if not episode:
            continue

        definition = definition_map.get(item["reaction_id"])
        if not definition:
            continue

        story = story_map.get(episode["story_id"])

        reaction_contributions.append({
            "id": item["id"],
            "created_at": item["created_at"],
            "reaction": definition,
            "episode": episode,
            "story": story,
        })

    review_contributions = []
    for item in reviews:
        episode = episode_map.get(item["episode_id"])
        if not episode:
            continue

        story = story_map.get(episode["story_id"])

        review_contributions.append({
            **item,
            "episode": episode,
            "story": story,
        })

    return {
        "continue_reading": continue_reading,
        "not_started": not_started,
        "caught_up": caught_up,
        "completed": completed,
        "saved": saved,
        "contributions": {
            "reactions": reaction_contributions,
            "reviews": review_contributions,
        },
        "entitlements": entitlements,
    }


@router.post("/library/bookmarks/{story_id}")
async def add_bookmark(
    story_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "bookmark_story",
        {"p_story_id": story_id},
        user.access_token,
    )


@router.delete("/library/bookmarks/{story_id}")
async def remove_bookmark(
    story_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "remove_story_bookmark",
        {"p_story_id": story_id},
        user.access_token,
    )


class ReaderPreferencesSubmission(BaseModel):
    theme: Literal["paper", "sepia", "night"] = "paper"
    text_size: Literal["small", "comfortable", "large"] = "comfortable"
    reading_width: Literal["narrow", "standard", "wide"] = "standard"


@router.get("/library/preferences")
async def get_reader_preferences(
    user: AuthenticatedUser = Depends(get_current_user),
):
    rows = await supabase.admin_get(
        "reader_preferences",
        {
            "select": "theme:reading_theme,text_size,reading_width,updated_at",
            "user_id": f"eq.{user.id}",
        },
    )

    if rows:
        return rows[0]

    return {
        "theme": "paper",
        "text_size": "comfortable",
        "reading_width": "standard",
        "updated_at": None,
    }


@router.put("/library/preferences")
async def save_reader_preferences(
    preferences: ReaderPreferencesSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_reader_preferences",
        {
            "p_theme": preferences.theme,
            "p_text_size": preferences.text_size,
            "p_reading_width": preferences.reading_width,
        },
        user.access_token,
    )


@router.post("/reviews/{review_id}/helpful")
async def vote_review_helpful(
    review_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "vote_review_helpful",
        {"p_review_id": review_id},
        user.access_token,
    )


@router.delete("/reviews/{review_id}/helpful")
async def remove_review_helpful_vote(
    review_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "remove_review_helpful_vote",
        {"p_review_id": review_id},
        user.access_token,
    )


class ContentReportSubmission(BaseModel):
    target_type: Literal["review", "author_reply", "author_note"]
    target_id: str
    reason: Literal[
        "spam",
        "harassment",
        "hate",
        "spoiler",
        "inappropriate",
        "misinformation",
        "other",
    ]
    details: str | None = None


@router.post("/reports")
async def submit_content_report(
    submission: ContentReportSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "report_content",
        {
            "p_target_type": submission.target_type,
            "p_target_id": submission.target_id,
            "p_reason": submission.reason,
            "p_details": submission.details,
        },
        user.access_token,
    )
