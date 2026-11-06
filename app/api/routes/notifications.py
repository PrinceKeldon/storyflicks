from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


class NotificationPreferencesSubmission(BaseModel):
    new_episodes: bool
    author_replies: bool
    author_notes: bool
    saved_story_updates: bool


@router.get("/notifications")
async def get_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    unread_only: bool = False,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "get_my_notifications",
        {
            "p_limit": limit,
            "p_unread_only": unread_only,
        },
        user.access_token,
    )


@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "mark_notification_read",
        {"p_notification_id": str(notification_id)},
        user.access_token,
    )


@router.patch("/notifications/read-all")
async def mark_all_notifications_read(
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "mark_all_notifications_read",
        {},
        user.access_token,
    )


@router.get("/notifications/preferences")
async def get_notification_preferences(
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "get_my_notification_preferences",
        {},
        user.access_token,
    )


@router.put("/notifications/preferences")
async def save_notification_preferences(
    preferences: NotificationPreferencesSubmission,
    user: AuthenticatedUser = Depends(get_current_user),
):
    return await supabase.user_rpc(
        "save_my_notification_preferences",
        {
            "p_new_episodes": preferences.new_episodes,
            "p_author_replies": preferences.author_replies,
            "p_author_notes": preferences.author_notes,
            "p_saved_story_updates": preferences.saved_story_updates,
        },
        user.access_token,
    )
