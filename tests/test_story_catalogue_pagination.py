import base64
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api.routes import stories


class StoryCataloguePaginationTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_cursor_when_an_extra_row_exists(self):
        rows = [
            {"id": f"00000000-0000-0000-0000-00000000000{i}", "published_at": f"2026-11-0{i}T12:00:00+00:00", "cover_path": None}
            for i in range(1, 4)
        ]
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=rows)) as admin_get:
            result = await stories.list_stories(limit=2)

        self.assertEqual(len(result["items"]), 2)
        self.assertIsNotNone(result["next_cursor"])
        admin_get.assert_awaited_once()
        self.assertEqual(admin_get.await_args.args[1]["limit"], "3")
        cursor_data = json.loads(base64.urlsafe_b64decode(result["next_cursor"] + "=="))
        self.assertEqual(cursor_data["id"], rows[1]["id"])

    async def test_search_and_cursor_filters_are_combined(self):
        cursor = base64.urlsafe_b64encode(
            json.dumps({
                "published_at": "2026-11-10T12:00:00+00:00",
                "id": "00000000-0000-0000-0000-000000000001",
            }).encode()
        ).decode().rstrip("=")
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=[])) as admin_get:
            await stories.list_stories(q="mystery", genre="Drama", limit=24, cursor=cursor)

        params = admin_get.await_args.args[1]
        self.assertIn("and", params)
        self.assertIn("title.ilike", params["and"])
        self.assertIn("published_at.lt", params["and"])
        self.assertEqual(params["genres"], "cs.{Drama}")

    async def test_rejects_malformed_cursor(self):
        with self.assertRaises(HTTPException) as raised:
            await stories.list_stories(cursor="not-a-valid-cursor")
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
