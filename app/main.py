from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import creator, creator_assets, creator_dashboard, creator_revisions, episodes, internal, library, notifications, stories
from app.core.config import settings

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(stories.router, prefix=settings.api_v1_prefix, tags=["Stories"])
app.include_router(episodes.router, prefix=settings.api_v1_prefix, tags=["Episodes"])
app.include_router(library.router, prefix=settings.api_v1_prefix, tags=["Library"])
app.include_router(notifications.router, prefix=settings.api_v1_prefix, tags=["Notifications"])
app.include_router(creator.router, prefix=settings.api_v1_prefix, tags=["Creator Studio"])
app.include_router(creator_assets.router, prefix=settings.api_v1_prefix, tags=["Creator Assets"])
app.include_router(creator_revisions.router, prefix=settings.api_v1_prefix, tags=["Creator Revisions"])
app.include_router(creator_dashboard.router, prefix=settings.api_v1_prefix, tags=["Creator Dashboard"])
app.include_router(internal.router, prefix=settings.api_v1_prefix, tags=["Internal Jobs"])


@app.get("/health", tags=["System"])
async def health():
    return {"status": "ok", "service": "storyflicks-api", "environment": settings.app_env}
