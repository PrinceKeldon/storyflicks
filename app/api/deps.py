from fastapi import Depends, HTTPException

from app.core.security import AuthenticatedUser, get_current_user
from app.services.supabase import supabase


async def get_creator_profile_status(user_id: str) -> str | None:
    profiles = await supabase.admin_get(
        "creator_profiles",
        {
            "id": f"eq.{user_id}",
            "select": "status",
            "limit": "1",
        },
    )
    return profiles[0].get("status") if profiles else None


async def require_active_creator(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    status = await get_creator_profile_status(user.id)
    if status != "active":
        raise HTTPException(
            status_code=403,
            detail="Creator Studio is available to approved creators only.",
        )
    return user


__all__ = [
    "get_current_user",
    "get_creator_profile_status",
    "require_active_creator",
    "supabase",
]
