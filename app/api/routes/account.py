from fastapi import APIRouter, Depends

from app.api.deps import get_creator_profile_status, get_current_user
from app.core.security import AuthenticatedUser

router = APIRouter()


@router.get("/account/creator-access")
async def get_creator_access(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Return the signed-in user's creator capability without exposing other accounts."""
    creator_status = await get_creator_profile_status(user.id)
    is_approved_creator = creator_status == "active"
    return {
        "account_role": "creator" if is_approved_creator else "reader",
        "creator_status": creator_status or "none",
        "can_access_creator_studio": is_approved_creator,
    }
}
