from urllib.parse import quote

from app.core.config import settings


def public_storage_url(storage_path: str | None) -> str | None:
    if not storage_path:
        return None

    bucket = quote(settings.story_assets_bucket, safe="")
    path = quote(storage_path, safe="/")
    return (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/"
        f"{bucket}/{path}"
    )
