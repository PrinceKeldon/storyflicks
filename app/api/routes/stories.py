import base64
from datetime import datetime
import json
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.security import AuthenticatedUser

from app.api.deps import supabase
from app.services.storage import public_storage_url

router = APIRouter()


@router.get("/stories")
async def list_stories(
    q: str | None = Query(default=None, max_length=100),
    genre: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=100, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
):
    params = {
        "select": "id,slug,title,author_name,tagline,synopsis,genres,cover_path,publication_status,completion_status,first_episode_free,section_label,section_label_plural,origin_type,content_format,published_at,updated_at",
        "publication_status": "eq.published",
        "deleted_at": "is.null",
        "order": "published_at.desc.nullslast,id.desc",
        "limit": str(limit + 1),
    }

    filters = []
    if q:
        safe_query = " ".join(re.findall(r"[\w-]+", q, flags=re.UNICODE))
        if safe_query:
            filters.append(
                f"or(title.ilike.*{safe_query}*,"
                f"tagline.ilike.*{safe_query}*,"
                f"synopsis.ilike.*{safe_query}*)"
            )

    if genre:
        safe_genre = " ".join(re.findall(r"[\w &-]+", genre, flags=re.UNICODE)).strip()
        if safe_genre:
            genre_value = f'"{safe_genre}"' if " " in safe_genre else safe_genre
            params["genres"] = f"cs.{{{genre_value}}}"

    if cursor:
        try:
            decoded = base64.b64decode(
                cursor + "=" * (-len(cursor) % 4),
                altchars=b"-_",
                validate=True,
            )
            cursor_data = json.loads(decoded)
            cursor_published_at = cursor_data["published_at"]
            if cursor_published_at is not None:
                if not isinstance(cursor_published_at, str):
                    raise ValueError("Invalid cursor timestamp")
                parsed_timestamp = datetime.fromisoformat(
                    cursor_published_at.replace("Z", "+00:00")
                )
                cursor_published_at = parsed_timestamp.isoformat()
            cursor_id = str(UUID(cursor_data["id"]))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid catalogue cursor.") from exc

        if cursor_published_at is None:
            # NULL timestamps sort last; continue within that final group by ID.
            filters.append(f"or(and(published_at.is.null,id.lt.{cursor_id}))")
        else:
            # Include the NULL group after all dated rows so no records are skipped.
            filters.append(
                f"or(published_at.lt.{cursor_published_at},"
                f"and(published_at.eq.{cursor_published_at},id.lt.{cursor_id}),"
                "published_at.is.null)"
            )

    if len(filters) == 1:
        params["or"] = filters[0][2:]
    elif len(filters) > 1:
        params["and"] = "(" + ",".join(filters) + ")"

    rows = await supabase.admin_get("stories", params)
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = None
    if has_more and page:
        last = page[-1]
        raw_cursor = json.dumps(
            {"published_at": last.get("published_at"), "id": last["id"]},
            separators=(",", ":"),
        ).encode()
        next_cursor = base64.urlsafe_b64encode(raw_cursor).decode().rstrip("=")

    return {
        "items": [
            {**row, "cover_url": public_storage_url(row.get("cover_path"))}
            for row in page
        ],
        "next_cursor": next_cursor,
    }


@router.get("/stories/{slug}")
async def get_story(slug: str = Path(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=100)):
    rows = await supabase.admin_get(
        "stories",
        {
            "select": "id,slug,title,author_name,tagline,synopsis,genres,cover_path,publication_status,first_episode_free,section_label,section_label_plural,origin_type,content_format,published_at,updated_at",
            "slug": f"eq.{slug}",
            "publication_status": "eq.published",
            "deleted_at": "is.null",
            "limit": "1",
        },
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Story not found.")

    story = rows[0]
    episodes = await supabase.admin_get(
        "episodes",
        {
            "select": "id,sequence_number,title,synopsis,publication_status,published_at",
            "story_id": f"eq.{story['id']}",
            "publication_status": "eq.published",
            "deleted_at": "is.null",
            "order": "sequence_number.asc",
        },
    )

    episode_ids = [episode["id"] for episode in episodes]
    episode_assets = []
    if episode_ids:
        episode_assets = await supabase.admin_get(
            "episode_assets",
            {
                "select": "id,episode_id,asset_type,storage_path,alt_text,position",
                "episode_id": f"in.({','.join(episode_ids)})",
                "order": "position.asc",
            },
        )

    episode_image_by_id = {}
    for asset in episode_assets:
        if asset.get("asset_type") != "inline_image" or not asset.get("storage_path"):
            continue
        episode_image_by_id.setdefault(
            str(asset["episode_id"]),
            {
                "url": public_storage_url(asset.get("storage_path")),
                "alt_text": asset.get("alt_text"),
            },
        )

    episodes = [
        {
            **episode,
            "image_url": episode_image_by_id.get(str(episode["id"]), {}).get("url"),
            "image_alt": episode_image_by_id.get(str(episode["id"]), {}).get("alt_text"),
        }
        for episode in episodes
    ]

    materials = await supabase.admin_get(
        "story_material_sections",
        {
            "select": "id,title,section_type,placement,position",
            "story_id": f"eq.{story['id']}",
            "publication_status": "eq.published",
            "is_visible": "eq.true",
            "deleted_at": "is.null",
            "order": "placement.asc,position.asc",
            "limit": "100",
        },
    )
    story["cover_url"] = public_storage_url(story.get("cover_path"))
    return {"story": story, "episodes": episodes, "materials": materials}


class FeaturedStorySubmission(BaseModel):
    story_id: str | None = None
    kicker: str = Field(default="FEATURED STORY", min_length=1, max_length=80)


@router.get("/discovery/featured")
async def get_discovery_featured():
    settings_rows = await supabase.admin_get(
        "discovery_settings",
        {"select": "featured_story_id,featured_kicker", "id": "eq.true", "limit": "1"},
    )
    if not settings_rows or not settings_rows[0].get("featured_story_id"):
        return {"story": None, "kicker": "FEATURED STORY"}
    settings = settings_rows[0]
    rows = await supabase.admin_get(
        "stories",
        {
            "select": "id,slug,title,author_name,tagline,synopsis,genres,cover_path,publication_status,completion_status,first_episode_free,section_label,section_label_plural,origin_type,content_format,published_at",
            "id": f"eq.{settings['featured_story_id']}",
            "publication_status": "eq.published",
            "deleted_at": "is.null",
            "limit": "1",
        },
    )
    if not rows:
        return {"story": None, "kicker": settings.get("featured_kicker") or "FEATURED STORY"}
    story = rows[0]
    story["cover_url"] = public_storage_url(story.get("cover_path"))
    return {"story": story, "kicker": settings.get("featured_kicker") or "FEATURED STORY"}


@router.put("/creator/discovery/featured")
async def set_discovery_featured(
    submission: FeaturedStorySubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    curators = await supabase.admin_get(
        "discovery_curators",
        {"user_id": f"eq.{user.id}", "select": "user_id", "limit": "1"},
    )
    if not curators:
        raise HTTPException(403, "Discovery curation permission is required.")
    story_id = submission.story_id
    if story_id:
        stories = await supabase.admin_get(
            "stories",
            {
                "id": f"eq.{story_id}",
                "publication_status": "eq.published",
                "deleted_at": "is.null",
                "select": "id",
                "limit": "1",
            },
        )
        if not stories:
            raise HTTPException(404, "Choose a published story to feature.")
    await supabase.admin_patch(
        "discovery_settings",
        {"id": "eq.true"},
        {"featured_story_id": story_id, "featured_kicker": submission.kicker.strip(), "updated_at": datetime.now().astimezone().isoformat()},
    )
    return {"featured_story_id": story_id, "featured_kicker": submission.kicker.strip()}
