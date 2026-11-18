import base64
import json
import re

from fastapi import APIRouter, HTTPException, Path, Query

from app.api.deps import supabase
from app.services.storage import public_storage_url

router = APIRouter()


@router.get("/stories")
async def list_stories(
    q: str | None = Query(default=None, max_length=100),
    genre: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=24, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
):
    params = {
        "select": "id,slug,title,author_name,tagline,synopsis,genres,cover_path,publication_status,completion_status,first_episode_free,section_label,section_label_plural,published_at,updated_at",
        "publication_status": "eq.published",
        "deleted_at": "is.null",
        "order": "published_at.desc,id.desc",
        "limit": str(limit + 1),
    }

    if q:
        safe_query = " ".join(re.findall(r"[\\w-]+", q, flags=re.UNICODE))
        if safe_query:
            params["or"] = (
                f"(title.ilike.*{safe_query}*,"
                f"tagline.ilike.*{safe_query}*,"
                f"synopsis.ilike.*{safe_query}*)"
            )

    if genre:
        safe_genre = " ".join(re.findall(r"[\\w &-]+", genre, flags=re.UNICODE)).strip()
        if safe_genre:
            genre_value = f'"{safe_genre}"' if " " in safe_genre else safe_genre
            params["genres"] = f"cs.{{{genre_value}}}"

    if cursor:
        try:
            decoded = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            cursor_data = json.loads(decoded)
            cursor_published_at = cursor_data["published_at"]
            cursor_id = cursor_data["id"]
            if not isinstance(cursor_published_at, str) or not isinstance(cursor_id, str):
                raise ValueError("Invalid cursor fields")
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", cursor_id):
                raise ValueError("Invalid cursor ID")
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid catalogue cursor.") from exc
        params["or"] = (
            f"(published_at.lt.{cursor_published_at},"
            f"and(published_at.eq.{cursor_published_at},id.lt.{cursor_id}))"
        )

    rows = await supabase.admin_get("stories", params)
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = None
    if has_more and page:
        last = page[-1]
        if last.get("published_at"):
            raw_cursor = json.dumps(
                {"published_at": last["published_at"], "id": last["id"]},
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
            "select": "id,slug,title,author_name,tagline,synopsis,genres,cover_path,publication_status,first_episode_free,section_label,section_label_plural,published_at,updated_at",
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
