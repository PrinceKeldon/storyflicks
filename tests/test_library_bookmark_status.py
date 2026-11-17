import unittest
from unittest.mock import AsyncMock, patch

from app.api.routes import library
from app.core.security import AuthenticatedUser


class BookmarkStatusRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_true_for_a_bookmark_owned_by_the_current_reader(self):
        user = AuthenticatedUser(id="reader-123", email=None, access_token="token")
        with patch.object(
            library.supabase,
            "admin_get",
            new=AsyncMock(return_value=[{"story_id": "story-456"}]),
        ) as admin_get:
            result = await library.get_bookmark_status("story-456", user)

        self.assertEqual(result, {"saved": True})
        admin_get.assert_awaited_once_with(
            "bookmarks",
            {
                "select": "story_id",
                "user_id": "eq.reader-123",
                "story_id": "eq.story-456",
                "limit": "1",
            },
        )

    async def test_returns_false_when_the_reader_has_not_saved_the_story(self):
        user = AuthenticatedUser(id="reader-123", email=None, access_token="token")
        with patch.object(
            library.supabase,
            "admin_get",
            new=AsyncMock(return_value=[]),
        ):
            result = await library.get_bookmark_status("story-456", user)

        self.assertEqual(result, {"saved": False})


if __name__ == "__main__":
    unittest.main()
