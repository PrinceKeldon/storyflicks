from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


async def _creator_story_ids(user: AuthenticatedUser) -> list[str]:
    profiles = await supabase.admin_get(
        "creator_profiles",
        {"id": f"eq.{user.id}", "status": "eq.active", "limit": "1"},
    )
    if not profiles:
        raise HTTPException(403, "An active creator profile is required.")
    assignments = await supabase.admin_get(
        "story_creators",
        {
            "creator_id": f"eq.{user.id}",
            "role": "in.(owner,author,editor)",
            "select": "story_id",
            "limit": "500",
        },
    )
    return list({row["story_id"] for row in assignments})


@router.get("/creator/trash")
async def list_creator_trash(user: AuthenticatedUser = Depends(get_current_user)):
    story_ids = await _creator_story_ids(user)
    if not story_ids:
        return {"stories": [], "episodes": [], "materials": []}
    story_filter = f"in.({','.join(story_ids)})"
    stories, episodes, materials = await __import__("asyncio").gather(
        supabase.admin_get(
            "stories",
            {
                "id": story_filter,
                "deleted_at": "not.is.null",
                "select": "id,title,slug,publication_status,deleted_at,deleted_from_status",
                "order": "deleted_at.desc",
                "limit": "200",
            },
        ),
        supabase.admin_get(
            "episodes",
            {
                "story_id": story_filter,
                "deleted_at": "not.is.null",
                "select": "id,story_id,sequence_number,title,publication_status,deleted_at,deleted_from_status",
                "order": "deleted_at.desc",
                "limit": "500",
            },
        ),
        supabase.admin_get(
            "story_material_sections",
            {
                "story_id": story_filter,
                "deleted_at": "not.is.null",
                "select": "id,story_id,title,section_type,placement,deleted_at,deleted_from_status",
                "order": "deleted_at.desc",
                "limit": "500",
            },
        ),
    )
    story_map = {row["id"]: row["title"] for row in stories}
    return {
        "stories": stories,
        "episodes": [
            {**row, "story_title": story_map.get(row["story_id"], "Story")}
            for row in episodes
        ],
        "materials": [
            {**row, "story_title": story_map.get(row["story_id"], "Story")}
            for row in materials
        ],
    }


@router.delete("/creator/stories/{story_id}")
async def delete_creator_story(
    story_id: UUID, user: AuthenticatedUser = Depends(get_current_user)
):
    return await supabase.user_rpc(
        "creator_delete_story", {"p_story_id": str(story_id)}, user.access_token
    )


@router.post("/creator/stories/{story_id}/restore")
async def restore_creator_story(
    story_id: UUID, user: AuthenticatedUser = Depends(get_current_user)
):
    return await supabase.user_rpc(
        "creator_restore_story", {"p_story_id": str(story_id)}, user.access_token
    )


@router.delete("/creator/episodes/{episode_id}")
async def delete_creator_episode(
    episode_id: UUID, user: AuthenticatedUser = Depends(get_current_user)
):
    return await supabase.user_rpc(
        "creator_delete_episode", {"p_episode_id": str(episode_id)}, user.access_token
    )


@router.post("/creator/episodes/{episode_id}/restore")
async def restore_creator_episode(
    episode_id: UUID, user: AuthenticatedUser = Depends(get_current_user)
):
    return await supabase.user_rpc(
        "creator_restore_episode", {"p_episode_id": str(episode_id)}, user.access_token
    )


@router.delete("/creator/episodes/{episode_id}/revisions/{revision_id}")
async def delete_creator_draft_revision(
    episode_id: UUID,
    revision_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    # The RPC verifies both the revision's owning story and draft-only status.
    rows = await supabase.admin_get(
        "episode_revisions",
        {
            "id": f"eq.{revision_id}",
            "episode_id": f"eq.{episode_id}",
            "select": "id",
            "limit": "1",
        },
    )
    if not rows:
        raise HTTPException(404, "Revision not found in this chapter.")
    return await supabase.user_rpc(
        "creator_delete_draft_revision",
        {"p_revision_id": str(revision_id)},
        user.access_token,
    )


@router.delete("/creator/stories/{story_id}/materials/{material_id}")
async def delete_creator_material(
    story_id: UUID,
    material_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    rows = await supabase.admin_get(
        "story_material_sections",
        {
            "id": f"eq.{material_id}",
            "story_id": f"eq.{story_id}",
            "select": "id",
            "limit": "1",
        },
    )
    if not rows:
        raise HTTPException(404, "Manuscript section not found in this story.")
    return await supabase.user_rpc(
        "creator_delete_material", {"p_material_id": str(material_id)}, user.access_token
    )


@router.post("/creator/stories/{story_id}/materials/{material_id}/restore")
async def restore_creator_material(
    story_id: UUID,
    material_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    rows = await supabase.admin_get(
        "story_material_sections",
        {
            "id": f"eq.{material_id}",
            "story_id": f"eq.{story_id}",
            "select": "id",
            "limit": "1",
        },
    )
    if not rows:
        raise HTTPException(404, "Manuscript section not found in this story.")
    return await supabase.user_rpc(
        "creator_restore_material", {"p_material_id": str(material_id)}, user.access_token
    )


@router.delete("/creator/trash/{entity_type}/{entity_id}/purge")
async def permanently_delete_creator_trash_item(
    entity_type: str,
    entity_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    if entity_type not in {"story", "episode", "material"}:
        raise HTTPException(422, "Unsupported Trash item type.")
    return await supabase.user_rpc(
        "creator_purge_trash",
        {"p_entity_type": entity_type, "p_entity_id": str(entity_id)},
        user.access_token,
    )
