from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, supabase
from app.core.security import AuthenticatedUser

router = APIRouter()


@router.get("/account/access")
async def get_account_access(user: AuthenticatedUser = Depends(get_current_user)):
    """Return the signed-in user's reader/creator capabilities.

    All authenticated users are readers. Creator capabilities are granted only
    when an active creator_profiles record exists; signup metadata is ignored.
    """
    creators = await supabase.admin_get(
        "creator_profiles",
        {
            "id": f"eq.{user.id}",
            "status": "eq.active",
            "select": "id,status",
            "limit": "1",
        },
    )
    return {
        "user_id": user.id,
        "email": user.email,
        "is_reader": True,
        "is_creator": bool(creators),
        "creator_status": "active" if creators else "reader",
    }
