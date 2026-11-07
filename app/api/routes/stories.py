import re

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import supabase
from app.services.storage import public_storage_url

router = APIRouter()


@router.get("/stories")
async def list_stories(
    q: str | None = Query(default=None, max_length=100),
    genre: str | None = Query(default=None, max_length=40),
):
    params = {
        "select": "id,slug,title,tagline,synopsis,genres,cover_path,publication_status,first_episode_free,published_at",
        "publication_status": "eq.published",
        "order": "published_at.desc",
        "limit": "100",
    }

    if q:
        safe_query = " ".join(re.findall(r"[\\w-]+", q, flags=re.UNICODE))
        if safe_query:
            params["or"] = (
                f"(title.ilike.*{safe_query}*,",
                f"tagline.ilike.*{safe_query}*,",
                f"synopsis.ilike.*{safe_query}*)"
            )

    if genre:
        safe_genre = " ".join(re.findall(r"[\\w &-]+", genre, flags=re.UNICODE)).strip()
        if safe_genre:
            genre_value = f'"{safe_genre}"' if " " in safe_genre else safe_genre
            params["genres"] = f"cs.{{{genre_value}}}"

    rows = await supabase.admin_get("stories", params)
    return {
        "items": [
            {**row, "cover_url": public_storage_url(row.get("cover_path"))}
            for row in rows
        ]
    }


@router.get("/stories/{slug}")
async def get_story(slug: str):
    rows = await supabase.admin_get(
        "stories",
        {
            "select": "id,slug,title,tagline,synopsis,genres,cover_path,publication_status,first_episode_free,published_at",
            "slug": f"eq.{slug}",
            "publication_status": "eq.published",
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
            "order": "sequence_number.asc",
        },
    )
    story["cover_url"] = public_storage_url(story.get("cover_path"))
    return {"story": story, "episodes": episodes}
