from typing import Literal
from uuid import UUID, uuid4
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, supabase
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.services.storage import public_storage_url

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
        expected_parent = f"{path_prefix}cover/"
    else:
        if submission.episode_id is None:
            raise HTTPException(422, "An episode_id is required for an episode image.")
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
        expected_parent = f"{path_prefix}episodes/{submission.episode_id}/"

    if not submission.storage_path.startswith(expected_parent):
        raise HTTPException(422, "Invalid image storage path.")

    filename = submission.storage_path[len(expected_parent):]
    stem, separator, extension = filename.rpartition(".")
    if not separator or "/" in filename:
        raise HTTPException(422, "Invalid image filename.")
    try:
        parsed_asset_id = UUID(stem)
    except ValueError as exc:
        raise HTTPException(422, "Invalid image filename.") from exc
    if str(parsed_asset_id) != stem.lower():
        raise HTTPException(422, "Invalid image filename.")

    try:
        object_info = await supabase.get_storage_object_info(
            settings.story_assets_bucket,
            submission.storage_path,
        )
    except HTTPException as exc:
        if exc.status_code == 404:
            raise HTTPException(
                422,
                "The uploaded image was not found in storage. Please upload it again.",
            ) from exc
        raise

    metadata = object_info.get("metadata") or {}
    content_type = (
        metadata.get("mimetype")
        or metadata.get("contentType")
        or object_info.get("mimetype")
    )
    object_size = metadata.get("size")
    if object_size is None:
        object_size = object_info.get("size")
    try:
        object_size = int(object_size)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            422,
            "Storage could not verify the uploaded image size.",
        ) from exc

    expected_extension = IMAGE_TYPES.get(content_type)
    if expected_extension is None or extension.lower() != expected_extension:
        raise HTTPException(422, "The uploaded image format does not match its file type.")
    if object_size <= 0 or object_size > 10 * 1024 * 1024:
        raise HTTPException(422, "Images must be between 1 byte and 10 MB.")

    if submission.asset_type == "cover":
        return await supabase.user_rpc(
            "set_creator_story_cover",
            {
                "p_story_id": str(story_id),
                "p_storage_path": submission.storage_path,
            },
            user.access_token,
        )

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



@router.get("/creator/stories/{story_id}/assets")
async def list_creator_story_assets(
    story_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    await require_story_editor(story_id, user)

    stories = await supabase.admin_get(
        "stories",
        {
            "id": f"eq.{story_id}",
            "select": "id,title,cover_path",
            "limit": "1",
        },
    )
    if not stories:
        raise HTTPException(404, "Story not found.")

    episodes = await supabase.admin_get(
        "episodes",
        {
            "story_id": f"eq.{story_id}",
            "select": "id,sequence_number,title",
            "order": "sequence_number.asc",
        },
    )

    assets = []
    if episodes:
        episode_ids = ",".join(item["id"] for item in episodes)
        assets = await supabase.admin_get(
            "episode_assets",
            {
                "episode_id": f"in.({episode_ids})",
                "select": "id,episode_id,asset_type,storage_path,alt_text,metadata,position",
                "order": "position.asc",
            },
        )

    return {
        "story": {
            **stories[0],
            "cover_url": public_storage_url(stories[0].get("cover_path")),
        },
        "episodes": episodes,
        "assets": [
            {
                **asset,
                "public_url": public_storage_url(asset.get("storage_path")),
            }
            for asset in assets
        ],
    }
