from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


@router.get("/creator/dashboard")
async def get_creator_dashboard(
    user: AuthenticatedUser = Depends(get_current_user),
):
    # Verify active creator status.
    creator_profiles = await supabase.admin_get(
        "creator_profiles",
        {
            "id": f"eq.{user.id}",
            "status": "eq.active",
        },
    )

    if not creator_profiles:
        raise HTTPException(
            status_code=403,
            detail="An active creator profile is required.",
        )

    # Find stories assigned to this creator.
    assignments = await supabase.admin_get(
        "story_creators",
        {"creator_id": f"eq.{user.id}"},
    )

    if not assignments:
        return {
            "overview": {
                "total_stories": 0,
                "published_stories": 0,
                "draft_stories": 0,
                "total_episodes": 0,
                "published_episodes": 0,
                "draft_episodes": 0,
                "total_reads": 0,
                "completed_reads": 0,
                "total_reactions": 0,
                "public_reviews": 0,
                "private_feedback": 0,
            },
            "stories": [],
        }

    story_ids = list({
        assignment["story_id"] for assignment in assignments
    })

    story_filter = f"in.({','.join(story_ids)})"

    stories = await supabase.admin_get(
        "stories",
        {"id": story_filter},
    )

    if not stories:
        return {
            "overview": {},
            "stories": [],
        }

    episodes = await supabase.admin_get(
        "episodes",
        {"story_id": story_filter},
    )

    episode_ids = [episode["id"] for episode in episodes]

    if episode_ids:
        episode_filter = f"in.({','.join(episode_ids)})"

        progress = await supabase.admin_get(
            "reading_progress",
            {"episode_id": episode_filter},
        )

        reactions = await supabase.admin_get(
            "reader_reactions",
            {"episode_id": episode_filter},
        )

        reviews = await supabase.admin_get(
            "reviews",
            {
                "episode_id": episode_filter,
                "status": "eq.submitted",
            },
        )
    else:
        progress = []
        reactions = []
        reviews = []

    notes = await supabase.admin_get(
        "author_notes",
        {"story_id": story_filter},
    )

    # Group related records by story.
    episodes_by_story = defaultdict(list)
    for episode in episodes:
        episodes_by_story[episode["story_id"]].append(episode)

    episode_to_story = {
        episode["id"]: episode["story_id"]
        for episode in episodes
    }

    progress_by_story = defaultdict(list)
    for item in progress:
        story_id = episode_to_story.get(item["episode_id"])
        if story_id:
            progress_by_story[story_id].append(item)

    reactions_by_story = defaultdict(int)
    for item in reactions:
        story_id = episode_to_story.get(item["episode_id"])
        if story_id:
            reactions_by_story[story_id] += 1

    reviews_by_story = defaultdict(list)
    for review in reviews:
        story_id = episode_to_story.get(review["episode_id"])
        if story_id:
            reviews_by_story[story_id].append(review)

    notes_by_story = defaultdict(list)
    for note in notes:
        notes_by_story[note["story_id"]].append(note)

    roles_by_story = {
        assignment["story_id"]: assignment["role"]
        for assignment in assignments
    }

    story_cards = []

    for story in stories:
        story_id = story["id"]
        story_episodes = episodes_by_story[story_id]
        story_progress = progress_by_story[story_id]
        story_reviews = reviews_by_story[story_id]
        story_notes = notes_by_story[story_id]

        published_episodes = [
            episode for episode in story_episodes
            if episode["publication_status"] == "published"
        ]

        draft_episodes = [
            episode for episode in story_episodes
            if episode["publication_status"] == "draft"
        ]

        scheduled_episodes = [
            episode for episode in story_episodes
            if episode["publication_status"] == "scheduled"
        ]

        story_cards.append({
            "id": story_id,
            "slug": story["slug"],
            "title": story["title"],
            "publication_status": story["publication_status"],
            "completion_status": story.get("completion_status"),
            "role": roles_by_story.get(story_id),
            "episode_count": len(story_episodes),
            "published_episode_count": len(published_episodes),
            "draft_episode_count": len(draft_episodes),
            "scheduled_episode_count": len(scheduled_episodes),
            "total_reads": len(story_progress),
            "completed_reads": sum(
                1 for item in story_progress
                if item.get("completed_at") is not None
            ),
            "reaction_count": reactions_by_story[story_id],
            "public_review_count": sum(
                1 for review in story_reviews
                if review["visibility"] == "public"
            ),
            "private_feedback_count": sum(
                1 for review in story_reviews
                if review["visibility"] == "private"
            ),
            "published_author_notes": sum(
                1 for note in story_notes
                if note["status"] == "published"
            ),
            "draft_author_notes": sum(
                1 for note in story_notes
                if note["status"] == "draft"
            ),
        })

    # Aggregate dashboard totals.
    overview = {
        "total_stories": len(stories),
        "published_stories": sum(
            1 for story in stories
            if story["publication_status"] == "published"
        ),
        "draft_stories": sum(
            1 for story in stories
            if story["publication_status"] == "draft"
        ),
        "total_episodes": len(episodes),
        "published_episodes": sum(
            1 for episode in episodes
            if episode["publication_status"] == "published"
        ),
        "draft_episodes": sum(
            1 for episode in episodes
            if episode["publication_status"] == "draft"
        ),
        "total_reads": len(progress),
        "completed_reads": sum(
            1 for item in progress
            if item.get("completed_at") is not None
        ),
        "total_reactions": len(reactions),
        "public_reviews": sum(
            1 for review in reviews
            if review["visibility"] == "public"
        ),
        "private_feedback": sum(
            1 for review in reviews
            if review["visibility"] == "private"
        ),
    }

    return {
        "overview": overview,
        "stories": story_cards,
    }
