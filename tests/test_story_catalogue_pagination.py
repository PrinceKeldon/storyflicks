import base64
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api.routes import stories


class StoryCataloguePaginationTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def encode_cursor(published_at, story_id):
        raw = json.dumps(
            {"published_at": published_at, "id": story_id},
            separators=(",", ":"),
        ).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    @staticmethod
    def decode_cursor(cursor):
        decoded = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        return json.loads(decoded)

    async def test_returns_cursor_when_an_extra_row_exists(self):
        rows = [
            {
                "id": f"00000000-0000-0000-0000-00000000000{i}",
                "published_at": f"2026-11-0{i}T12:00:00+00:00",
                "cover_path": None,
            }
            for i in range(1, 4)
        ]
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=rows)) as admin_get:
            result = await stories.list_stories(q=None, genre=None, limit=2, cursor=None)

        self.assertEqual(len(result["items"]), 2)
        self.assertIsNotNone(result["next_cursor"])
        admin_get.assert_awaited_once()
        self.assertEqual(admin_get.await_args.args[1]["limit"], "3")
        self.assertEqual(self.decode_cursor(result["next_cursor"])["id"], rows[1]["id"])

    async def test_null_published_at_page_emits_a_continuation_cursor(self):
        rows = [
            {"id": f"00000000-0000-0000-0000-00000000000{i}", "published_at": None, "cover_path": None}
            for i in range(1, 4)
        ]
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=rows)) as admin_get:
            result = await stories.list_stories(q=None, genre=None, limit=2, cursor=None)

        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(self.decode_cursor(result["next_cursor"]), {
            "published_at": None,
            "id": rows[1]["id"],
        })
        self.assertEqual(
            admin_get.await_args.args[1]["order"],
            "published_at.desc.nullslast,id.desc",
        )

    async def test_null_cursor_continues_within_null_timestamp_group(self):
        cursor = self.encode_cursor(
            None,
            "00000000-0000-0000-0000-000000000002",
        )
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=[])) as admin_get:
            await stories.list_stories(q=None, genre=None, limit=2, cursor=cursor)

        params = admin_get.await_args.args[1]
        self.assertIn("and(published_at.is.null,id.lt.00000000-0000-0000-0000-000000000002)", params["or"])

    async def test_dated_cursor_includes_null_timestamp_group_after_dated_rows(self):
        cursor = self.encode_cursor(
            "2026-11-10T12:00:00+00:00",
            "00000000-0000-0000-0000-000000000002",
        )
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=[])) as admin_get:
            await stories.list_stories(q=None, genre=None, limit=2, cursor=cursor)

        params = admin_get.await_args.args[1]
        self.assertIn("published_at.lt", params["or"])
        self.assertIn("published_at.is.null", params["or"])

    async def test_search_and_cursor_filters_are_combined(self):
        cursor = self.encode_cursor(
            "2026-11-10T12:00:00+00:00",
            "00000000-0000-0000-0000-000000000001",
        )
        with patch.object(stories.supabase, "admin_get", new=AsyncMock(return_value=[])) as admin_get:
            await stories.list_stories(q="mystery", genre="Drama", limit=24, cursor=cursor)

        params = admin_get.await_args.args[1]
        self.assertIn("and", params)
        self.assertIn("title.ilike", params["and"])
        self.assertIn("published_at.lt", params["and"])
        self.assertIn("published_at.is.null", params["and"])
        self.assertEqual(params["genres"], "cs.{Drama}")

    async def test_rejects_malformed_cursor(self):
        with self.assertRaises(HTTPException) as raised:
            await stories.list_stories(q=None, genre=None, limit=24, cursor="not-a-valid-cursor")
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
