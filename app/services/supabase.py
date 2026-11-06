from typing import Any
import logging

import httpx
from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)


class SupabaseService:

    def _admin_headers(self) -> dict[str, str]:
        key = settings.supabase_service_role_key
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _user_headers(self, access_token: str) -> dict[str, str]:
        return {
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

    async def admin_get(
        self, table: str, params: dict[str, str] | None = None
    ) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{settings.supabase_rest_url}/{table}",
                headers=self._admin_headers(),
                params=params or {},
            )

        self._raise_for_supabase(response)
        data = response.json()
        return data if isinstance(data, list) else []


    async def admin_rpc(
        self,
        function_name: str,
        payload: dict[str, Any],
    ) -> Any:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.supabase_rest_url}/rpc/{function_name}",
                headers=self._admin_headers(),
                json=payload,
            )
        self._raise_for_supabase(response)
        return response.json()

    async def user_rpc(
        self, function_name: str, payload: dict[str, Any], access_token: str
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{settings.supabase_rest_url}/rpc/{function_name}",
                headers=self._user_headers(access_token),
                json=payload,
            )

        self._raise_for_supabase(response)
        return response.json()

    @staticmethod
    def _raise_for_supabase(response: httpx.Response) -> None:
        if response.is_success:
            return

        try:
            error_body = response.json()
        except ValueError:
            error_body = response.text[:1000]

        logger.error(
            "Supabase request failed: status=%s body=%s",
            response.status_code,
            error_body,
        )

        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=403,
                detail="The requested database operation is not permitted.",
            )

        if response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail="The requested record was not found.",
            )

        raise HTTPException(
            status_code=502,
            detail="The database service could not complete the request.",
        )


supabase = SupabaseService()
