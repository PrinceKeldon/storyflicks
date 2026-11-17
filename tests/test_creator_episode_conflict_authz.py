import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException

from app.api.routes.creator import (
    CreatorEpisodeSubmission,
    create_creator_episode,
    update_creator_episode,
)
from app.core.security import AuthenticatedUser

STORY_ID = UUID("11111111-1111-4111-8111-111111111111")
EPISODE_ID = UUID("22222222-2222-4222-8222-222222222222")
USER = AuthenticatedUser(
    id="44444444-4444-4444-8444-444444444444",
    email="reader@example.test",
    access_token="test-token",
)


def submission() -> CreatorEpisodeSubmission:
    return CreatorEpisodeSubmission(
        sequence_number=3, title="Draft title", content={"blocks": []}
    )


class ChapterConflictAuthorisationTests(unittest.IsolatedAsyncioTestCase):
    """The 409 conflict message names another chapter, so it must never reach a non-editor."""

    async def _assert_forbidden_without_lookup(self, call):
        with (
            patch(
                "app.api.routes.creator.require_story_editor",
                new_callable=AsyncMock,
                side_effect=HTTPException(403, "You do not have permission to edit this story."),
            ),
            patch("app.api.routes.creator.supabase.admin_get", new_callable=AsyncMock) as admin_get,
            patch("app.api.routes.creator.supabase.user_rpc", new_callable=AsyncMock) as user_rpc,
        ):
            with self.assertRaises(HTTPException) as caught:
                await call()
        self.assertEqual(caught.exception.status_code, 403)
        admin_get.assert_not_called()
        user_rpc.assert_not_called()

    async def test_create_rejects_non_editor_before_conflict_lookup(self):
        await self._assert_forbidden_without_lookup(
            lambda: create_creator_episode(STORY_ID, submission(), USER)
        )

    async def test_update_rejects_non_editor_before_conflict_lookup(self):
        await self._assert_forbidden_without_lookup(
            lambda: update_creator_episode(STORY_ID, EPISODE_ID, submission(), USER)
        )

    async def test_editor_still_sees_conflicting_chapter_title(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch(
                "app.api.routes.creator.supabase.admin_get",
                new_callable=AsyncMock,
                return_value=[{"id": "x", "title": "The Confession"}],
            ),
            patch("app.api.routes.creator.supabase.user_rpc", new_callable=AsyncMock) as user_rpc,
        ):
            with self.assertRaises(HTTPException) as caught:
                await create_creator_episode(STORY_ID, submission(), USER)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("The Confession", caught.exception.detail)
        user_rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
