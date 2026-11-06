from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


@router.get("/creator/episodes/{episode_id}/revisions")
async def list_creator_episode_revisions(
    episode_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    creator_profiles = await supabase.admin_get(
        "creator_profiles",
        {"id": f"eq.{user.id}", "status": "eq.active", "limit": "1"},
    )
    if not creator_profiles:
        raise HTTPException(403, "An active creator profile is required.")

    episodes = await supabase.admin_get(
        "episodes",
        {
            "id": f"eq.{episode_id}",
            "select": "id,story_id,sequence_number,title,publication_status,scheduled_at,published_at",
            "limit": "1",
        },
    )
    if not episodes:
        raise HTTPException(404, "Episode not found.")

    episode = episodes[0]
    assignments = await supabase.admin_get(
        "story_creators",
        {
            "story_id": f"eq.{episode['story_id']}",
            "creator_id": f"eq.{user.id}",
            "limit": "1",
        },
    )
    if not assignments:
        raise HTTPException(403, "You are not assigned to this story.")

    revisions = await supabase.admin_get(
        "episode_revisions",
        {
            "episode_id": f"eq.{episode_id}",
            "select": (
                "id,revision_number,title,synopsis,content,revision_status,"
                "created_by,created_at,published_at"
            ),
            "order": "revision_number.desc",
        },
    )

    return {
        "episode": episode,
        "revisions": revisions,
        "revision_count": len(revisions),
    }
