from fastapi import APIRouter, HTTPException

from app.api.deps import supabase
from app.services.storage import public_storage_url

router = APIRouter()


@router.get("/stories")
async def list_stories():
    rows = await supabase.admin_get(
        "stories",
        {
            "select": "id,slug,title,tagline,synopsis,cover_path,publication_status,first_episode_free,published_at",
            "publication_status": "eq.published",
            "order": "published_at.desc",
        },
    )
    return {"items": [{**row, "cover_url": public_storage_url(row.get("cover_path"))} for row in rows]}


@router.get("/stories/{slug}")
async def get_story(slug: str):
    rows = await supabase.admin_get(
        "stories",
        {
            "select": "id,slug,title,tagline,synopsis,cover_path,publication_status,first_episode_free,published_at",
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
