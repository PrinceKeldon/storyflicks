import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.creator import (
    CreatorEpisodeOrderSubmission,
    CreatorEpisodeReviewSubmission,
    reorder_creator_episodes,
    set_creator_episode_review_status,
)
from app.core.security import AuthenticatedUser

STORY = UUID("11111111-1111-4111-8111-111111111111")
A = UUID("22222222-2222-4222-8222-222222222222")
B = UUID("33333333-3333-4333-8333-333333333333")
USER = AuthenticatedUser(id="44444444-4444-4444-8444-444444444444", email="a@example.test", access_token="t")


class ReviewStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_marks_a_draft_ready(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_get", new_callable=AsyncMock) as get,
            patch("app.api.routes.creator.supabase.admin_patch", new_callable=AsyncMock) as patch_row,
        ):
            get.return_value = [{"id": str(A), "publication_status": "draft"}]
            result = await set_creator_episode_review_status(STORY, A, CreatorEpisodeReviewSubmission(ready=True), USER)
        self.assertEqual(result, {"episode_id": str(A), "ready_for_review": True})
        self.assertEqual(patch_row.await_args.args[2], {"ready_for_review": True})

    async def test_refuses_published_chapters(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_get", new_callable=AsyncMock) as get,
            patch("app.api.routes.creator.supabase.admin_patch", new_callable=AsyncMock) as patch_row,
        ):
            get.return_value = [{"id": str(A), "publication_status": "published"}]
            with self.assertRaises(HTTPException) as caught:
                await set_creator_episode_review_status(STORY, A, CreatorEpisodeReviewSubmission(ready=True), USER)
        self.assertEqual(caught.exception.status_code, 409)
        patch_row.assert_not_awaited()

    async def test_unknown_chapter_is_404(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_get", new_callable=AsyncMock) as get,
        ):
            get.return_value = []
            with self.assertRaises(HTTPException) as caught:
                await set_creator_episode_review_status(STORY, A, CreatorEpisodeReviewSubmission(ready=False), USER)
        self.assertEqual(caught.exception.status_code, 404)


class ReorderTests(unittest.IsolatedAsyncioTestCase):
    async def test_passes_the_order_to_the_database_function(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock) as guard,
            patch("app.api.routes.creator.supabase.admin_rpc", new_callable=AsyncMock) as rpc,
        ):
            rpc.return_value = 2
            result = await reorder_creator_episodes(STORY, CreatorEpisodeOrderSubmission(episode_ids=[B, A]), USER)
        guard.assert_awaited_once()
        self.assertEqual(rpc.await_args.args[0], "reorder_creator_episodes")
        self.assertEqual(rpc.await_args.args[1]["p_episode_ids"], [str(B), str(A)])
        self.assertEqual(result["count"], 2)

    async def test_rejects_duplicates_before_touching_the_database(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_rpc", new_callable=AsyncMock) as rpc,
        ):
            with self.assertRaises(HTTPException) as caught:
                await reorder_creator_episodes(STORY, CreatorEpisodeOrderSubmission(episode_ids=[A, A]), USER)
        self.assertEqual(caught.exception.status_code, 422)
        rpc.assert_not_awaited()

    async def test_stale_list_becomes_a_conflict(self):
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_rpc", new_callable=AsyncMock) as rpc,
        ):
            rpc.side_effect = HTTPException(400, "The new order must list every chapter of the story exactly once")
            with self.assertRaises(HTTPException) as caught:
                await reorder_creator_episodes(STORY, CreatorEpisodeOrderSubmission(episode_ids=[A]), USER)
        self.assertEqual(caught.exception.status_code, 409)

    def test_empty_order_is_invalid(self):
        with self.assertRaises(ValidationError):
            CreatorEpisodeOrderSubmission(episode_ids=[])


if __name__ == "__main__":
    unittest.main()
