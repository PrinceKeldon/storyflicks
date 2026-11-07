import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

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


@router.get("/creator/analytics")
async def get_creator_analytics(
    story_id: UUID | None = None,
    days: int = Query(default=30, ge=7, le=90),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Aggregate creator-owned reading and contribution activity.

    Progress rows are records per reader and episode, not raw page views.
    Daily progress activity uses the row's last updated_at timestamp.
    Private review content is never selected or returned.
    """
    profiles = await supabase.admin_get(
        "creator_profiles",
        {"id": f"eq.{user.id}", "status": "eq.active", "limit": "1"},
    )
    if not profiles:
        raise HTTPException(403, "An active creator profile is required.")

    assignments = await supabase.admin_get(
        "story_creators",
        {"creator_id": f"eq.{user.id}", "select": "story_id,role"},
    )
    allowed_roles = {"owner", "author", "editor"}
    allowed_story_ids = {
        row["story_id"] for row in assignments
        if row.get("role") in allowed_roles
    }
    if story_id:
        if str(story_id) not in allowed_story_ids:
            raise HTTPException(403, "You do not have creator access to this story.")
        allowed_story_ids = {str(story_id)}

    if not allowed_story_ids:
        return {
            "range_days": days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "unique_readers": 0, "progress_records": 0,
                "completed_progress_records": 0, "reactions": 0,
                "public_reviews": 0, "private_feedback": 0,
                "completion_rate": 0,
            },
            "timeline": [],
            "episodes": [],
        }

    story_filter = f"in.({','.join(sorted(allowed_story_ids))})"
    stories = await supabase.admin_get(
        "stories", {"id": story_filter, "select": "id,title,slug"}
    )
    episodes = await supabase.admin_get(
        "episodes",
        {
            "story_id": story_filter,
            "publication_status": "eq.published",
            "select": "id,story_id,title,sequence_number,published_at",
            "order": "sequence_number.asc",
        },
    )
    if not episodes:
        return {
            "range_days": days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "unique_readers": 0, "progress_records": 0,
                "completed_progress_records": 0, "reactions": 0,
                "public_reviews": 0, "private_feedback": 0,
                "completion_rate": 0,
            },
            "timeline": [],
            "episodes": [],
        }

    episode_ids = [row["id"] for row in episodes]
    episode_filter = f"in.({','.join(episode_ids)})"
    progress, reactions, reviews = await asyncio.gather(
        supabase.admin_get(
            "reading_progress",
            {
                "episode_id": episode_filter,
                "select": "episode_id,user_id,progress_percent,completed_at,updated_at,started_at",
            },
        ),
        supabase.admin_get(
            "reader_reactions",
            {
                "episode_id": episode_filter,
                "select": "episode_id,user_id,created_at",
            },
        ),
        supabase.admin_get(
            "reviews",
            {
                "episode_id": episode_filter,
                "status": "eq.submitted",
                "select": "episode_id,user_id,visibility,submitted_at",
            },
        ),
    )

    story_map = {row["id"]: row for row in stories}
    by_episode = {
        row["id"]: {
            "id": row["id"],
            "story_id": row["story_id"],
            "story_title": story_map.get(row["story_id"], {}).get("title", "Story"),
            "sequence_number": row["sequence_number"],
            "title": row["title"],
            "progress_records": 0,
            "completed_progress_records": 0,
            "unique_readers": set(),
            "reactions": 0,
            "public_reviews": 0,
            "private_feedback": 0,
        }
        for row in episodes
    }

    today = datetime.now(timezone.utc).date()
    start_day = today - timedelta(days=days - 1)
    timeline_by_day = {
        (start_day + timedelta(days=i)).isoformat(): {
            "date": (start_day + timedelta(days=i)).isoformat(),
            "progress_updates": 0,
            "reactions": 0,
            "public_reviews": 0,
            "private_feedback": 0,
            "active_readers": set(),
        }
        for i in range(days)
    }

    all_readers: set[str] = set()
    completed_count = 0
    for row in progress:
        item = by_episode.get(row["episode_id"])
        if not item:
            continue
        item["progress_records"] += 1
        reader = row["user_id"]
        item["unique_readers"].add(reader)
        all_readers.add(reader)
        if row.get("completed_at"):
            item["completed_progress_records"] += 1
            completed_count += 1
        updated_at = row.get("updated_at")
        if updated_at:
            try:
                event_date = datetime.fromisoformat(updated_at.replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
            except (ValueError, AttributeError):
                event_date = None
            if event_date in timeline_by_day:
                timeline_by_day[event_date]["progress_updates"] += 1
                timeline_by_day[event_date]["active_readers"].add(reader)

    for row in reactions:
        item = by_episode.get(row["episode_id"])
        if not item:
            continue
        item["reactions"] += 1
        reader = row["user_id"]
        item["unique_readers"].add(reader)
        all_readers.add(reader)
        created_at = row.get("created_at")
        if created_at:
            try:
                event_date = datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
            except (ValueError, AttributeError):
                event_date = None
            if event_date in timeline_by_day:
                timeline_by_day[event_date]["reactions"] += 1
                timeline_by_day[event_date]["active_readers"].add(reader)

    public_reviews = 0
    private_feedback = 0
    for row in reviews:
        item = by_episode.get(row["episode_id"])
        if not item:
            continue
        reader = row["user_id"]
        item["unique_readers"].add(reader)
        all_readers.add(reader)
        is_public = row.get("visibility") == "public"
        if is_public:
            item["public_reviews"] += 1
            public_reviews += 1
        elif row.get("visibility") == "private":
            item["private_feedback"] += 1
            private_feedback += 1
        submitted_at = row.get("submitted_at")
        if submitted_at:
            try:
                event_date = datetime.fromisoformat(submitted_at.replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
            except (ValueError, AttributeError):
                event_date = None
            if event_date in timeline_by_day:
                key = "public_reviews" if is_public else "private_feedback"
                timeline_by_day[event_date][key] += 1
                timeline_by_day[event_date]["active_readers"].add(reader)
                active_readers_by_day[event_date].add(reader)

    episode_rows = []
    for item in by_episode.values():
        episode_rows.append({
            **item,
            "unique_readers": len(item["unique_readers"]),
        })

    timeline = []
    for row in timeline_by_day.values():
        timeline.append({
            **row,
            "active_readers": len(row["active_readers"]),
        })

    progress_count = len(progress)
    return {
        "range_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "unique_readers": len(all_readers),
            "progress_records": progress_count,
            "completed_progress_records": completed_count,
            "reactions": len(reactions),
            "public_reviews": public_reviews,
            "private_feedback": private_feedback,
            "completion_rate": round((completed_count / progress_count) * 100, 1) if progress_count else 0,
        },
        "timeline": timeline,
        "episodes": episode_rows,
    }
