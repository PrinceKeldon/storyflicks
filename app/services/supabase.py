from typing import Any
from urllib.parse import quote
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


    async def admin_delete(
        self, table: str, params: dict[str, str]
    ) -> None:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.delete(
                f"{settings.supabase_rest_url}/{table}",
                headers={**self._admin_headers(), "Prefer": "return=minimal"},
                params=params,
            )
        self._raise_for_supabase(response)


    async def admin_insert(self, table: str, payload: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{settings.supabase_rest_url}/{table}",
                headers={**self._admin_headers(), "Prefer": "return=minimal"},
                json=payload,
            )
        self._raise_for_supabase(response)
        return response.json() if response.content else None

    async def admin_insert_if_missing(
        self, table: str, payload: dict[str, Any], on_conflict: str
    ) -> None:
        """Insert a row unless one with the same `on_conflict` column(s) exists.

        An existing row is left untouched, so this is safe to repeat.
        """
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{settings.supabase_rest_url}/{table}",
                headers={
                    **self._admin_headers(),
                    "Prefer": "resolution=ignore-duplicates,return=minimal",
                },
                params={"on_conflict": on_conflict},
                json=payload,
            )
        self._raise_for_supabase(response)

    async def admin_patch_returning(
        self, table: str, params: dict[str, str], payload: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Update matching rows and return them.

        Used to claim a row atomically: filter on the expected current status,
        and an empty result means another request got there first.
        """
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.patch(
                f"{settings.supabase_rest_url}/{table}",
                headers={**self._admin_headers(), "Prefer": "return=representation"},
                params=params,
                json=payload,
            )
        self._raise_for_supabase(response)
        data = response.json() if response.content else []
        return data if isinstance(data, list) else []

    async def admin_patch(
        self, table: str, params: dict[str, str], payload: dict[str, Any]
    ) -> Any:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.patch(
                f"{settings.supabase_rest_url}/{table}",
                headers={**self._admin_headers(), "Prefer": "return=minimal"},
                params=params,
                json=payload,
            )
        self._raise_for_supabase(response)
        return response.json() if response.content else None

    async def admin_get_all(
        self,
        table: str,
        params: dict[str, str] | None = None,
        page_size: int = 500,
    ) -> list[dict[str, Any]]:
        """Fetch every matching row using bounded PostgREST offset pages."""
        if page_size < 1 or page_size > 1000:
            raise ValueError("page_size must be between 1 and 1000")

        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page_params = {
                **(params or {}),
                "limit": str(page_size),
                "offset": str(offset),
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{settings.supabase_rest_url}/{table}",
                    headers=self._admin_headers(),
                    params=page_params,
                )

            self._raise_for_supabase(response)
            data = response.json()
            if not isinstance(data, list):
                break

            rows.extend(data)
            if len(data) < page_size:
                break
            offset += page_size

        return rows


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

    async def get_storage_object_info(
        self, bucket: str, storage_path: str
    ) -> dict[str, Any]:
        encoded_path = quote(storage_path, safe="/")
        endpoint = (
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/info/"
            f"{quote(bucket, safe='')}/{encoded_path}"
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                endpoint,
                headers=self._admin_headers(),
            )
        self._raise_for_supabase(response)
        payload = response.json()
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=502,
                detail="Storage returned invalid object metadata.",
            )
        return payload

    async def delete_storage_object(
        self, bucket: str, storage_path: str
    ) -> None:
        encoded_path = quote(storage_path, safe="/")
        endpoint = (
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/"
            f"{quote(bucket, safe='')}/{encoded_path}"
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                endpoint,
                headers=self._admin_headers(),
            )
        self._raise_for_supabase(response)


    async def create_signed_upload_url(self, bucket: str, storage_path: str) -> dict[str, Any]:
        encoded_path = quote(storage_path, safe="/")
        endpoint = (
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/upload/sign/"
            f"{quote(bucket, safe='')}/{encoded_path}"
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                endpoint,
                headers=self._admin_headers(),
                json={"upsert": False},
            )

        self._raise_for_supabase(response)
        payload = response.json()
        signed_path = (
            payload.get("signedUrl")
            or payload.get("signedURL")
            or payload.get("url")
        )
        if not signed_path:
            raise HTTPException(
                status_code=502,
                detail="Storage did not return a signed upload URL.",
            )

        if signed_path.startswith("http://") or signed_path.startswith("https://"):
            pass
        elif signed_path.startswith("/storage/v1/"):
            signed_path = f"{settings.supabase_url.rstrip('/')}{signed_path}"
        elif signed_path.startswith("/"):
            signed_path = f"{settings.supabase_url.rstrip('/')}/storage/v1{signed_path}"
        else:
            signed_path = (
                f"{settings.supabase_url.rstrip('/')}/storage/v1/{signed_path.lstrip('/')}"
            )

        return {
            "signed_url": signed_path,
            "token": payload.get("token"),
            "path": payload.get("path") or storage_path,
            "bucket": bucket,
        }

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

        # Do not write upstream error payloads to logs: database errors can
        # include user-supplied values and other request-specific data.
        logger.error("Supabase request failed: status=%s", response.status_code)

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
