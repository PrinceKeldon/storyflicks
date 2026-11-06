from typing import Literal
from uuid import UUID, uuid4
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, supabase
from app.core.config import settings
from app.core.security import AuthenticatedUser

router = APIRouter()

IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
}
CREATOR_ROLES = {"owner", "author", "editor"}


class CreatorAssetUploadRequest(BaseModel):
    asset_type: Literal["cover", "episode_image"]
    content_type: Literal[
        "image/jpeg", "image/png", "image/webp", "image/avif"
    ]
    episode_id: UUID | None = None


class CreatorAssetCompleteRequest(BaseModel):
    asset_type: Literal["cover", "episode_image"]
    storage_path: str = Field(min_length=1, max_length=1024)
    episode_id: UUID | None = None
    alt_text: str | None = Field(default=None, max_length=500)
    position: int = Field(default=0, ge=0, le=10000)


async def require_story_editor(story_id: UUID, user: AuthenticatedUser) -> None:
    creator_profiles = await supabase.admin_get(
        "creator_profiles",
        {"id": f"eq.{user.id}", "status": "eq.active", "limit": "1"},
    )
    if not creator_profiles:
        raise HTTPException(403, "An active creator profile is required.")

    assignments = await supabase.admin_get(
        "story_creators",
        {
            "story_id": f"eq.{story_id}",
            "creator_id": f"eq.{user.id}",
            "role": "in.(owner,author,editor)",
            "limit": "1",
        },
    )
    if not assignments or assignments[0].get("role") not in CREATOR_ROLES:
        raise HTTPException(403, "You do not have permission to edit this story.")


@router.post("/creator/stories/{story_id}/assets/upload-url")
async def create_creator_asset_upload_url(
    story_id: UUID,
    submission: CreatorAssetUploadRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)

    if submission.asset_type == "cover" and submission.episode_id is not None:
        raise HTTPException(422, "A story cover cannot include an episode_id.")

    if submission.asset_type == "episode_image" and submission.episode_id is None:
        raise HTTPException(422, "An episode_id is required for an episode image.")

    if submission.episode_id is not None:
        episodes = await supabase.admin_get(
            "episodes",
            {
                "id": f"eq.{submission.episode_id}",
                "story_id": f"eq.{story_id}",
                "select": "id",
                "limit": "1",
            },
        )
        if not episodes:
            raise HTTPException(404, "Episode not found in this story.")

    extension = IMAGE_TYPES[submission.content_type]
    asset_id = uuid4()

    if submission.asset_type == "cover":
        storage_path = (
            f"{user.id}/{story_id}/cover/{asset_id}.{extension}"
        )
    else:
        storage_path = (
            f"{user.id}/{story_id}/episodes/"
            f"{submission.episode_id}/{asset_id}.{extension}"
        )

    signed = await supabase.create_signed_upload_url(
        settings.story_assets_bucket,
        storage_path,
    )

    encoded_path = quote(storage_path, safe="/")
    public_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/"
        f"{quote(settings.story_assets_bucket, safe='')}/{encoded_path}"
    )

    return {
        **signed,
        "asset_type": submission.asset_type,
        "content_type": submission.content_type,
        "public_url": public_url,
        "upload_method": "PUT",
        "upload_headers": {"Content-Type": submission.content_type},
        "expires_in_seconds": 7200,
    }


@router.post("/creator/stories/{story_id}/assets/complete")
async def complete_creator_asset_upload(
    story_id: UUID,
    submission: CreatorAssetCompleteRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)

    path_prefix = f"{user.id}/{story_id}/"
    if not submission.storage_path.startswith(path_prefix):
        raise HTTPException(422, "The storage path does not belong to this creator and story.")

    if submission.asset_type == "cover":
        if submission.episode_id is not None:
            raise HTTPException(422, "A story cover cannot include an episode_id.")
        if not submission.storage_path.startswith(f"{path_prefix}cover/"):
            raise HTTPException(422, "Invalid story cover storage path.")

        return await supabase.user_rpc(
            "set_creator_story_cover",
            {
                "p_story_id": str(story_id),
                "p_storage_path": submission.storage_path,
            },
            user.access_token,
        )

    if submission.episode_id is None:
        raise HTTPException(422, "An episode_id is required for an episode image.")

    episode_prefix = (
        f"{path_prefix}episodes/{submission.episode_id}/"
    )
    if not submission.storage_path.startswith(episode_prefix):
        raise HTTPException(422, "Invalid episode image storage path.")

    return await supabase.user_rpc(
        "register_creator_episode_image",
        {
            "p_episode_id": str(submission.episode_id),
            "p_storage_path": submission.storage_path,
            "p_alt_text": submission.alt_text,
            "p_position": submission.position,
        },
        user.access_token,
    )
