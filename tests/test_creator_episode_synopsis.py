import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID
from datetime import datetime, timezone

from app.api.routes.creator import (
    CreatorEpisodeSynopsisSubmission,
    save_creator_episode_synopsis,
)
from app.core.security import AuthenticatedUser


class CreatorEpisodeSynopsisSaveTests(unittest.IsolatedAsyncioTestCase):
    async def test_saves_episode_guide_synopsis_and_latest_draft_metadata(self):
        story_id = UUID("11111111-1111-4111-8111-111111111111")
        episode_id = UUID("22222222-2222-4222-8222-222222222222")
        revision_id = "33333333-3333-4333-8333-333333333333"
        user = AuthenticatedUser(
            id="44444444-4444-4444-8444-444444444444",
            email="author@example.test",
            access_token="test-token",
        )
        synopsis = "A new synopsis for the public section guide."
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_get", new_callable=AsyncMock) as admin_get,
            patch("app.api.routes.creator.supabase.admin_patch", new_callable=AsyncMock) as admin_patch,
        ):
            admin_get.side_effect = [
                [{"id": str(episode_id)}],
                [{"id": revision_id}],
            ]
            result = await save_creator_episode_synopsis(
                story_id,
                episode_id,
                CreatorEpisodeSynopsisSubmission(synopsis=synopsis),
                user,
            )

        self.assertEqual(result, {"episode_id": str(episode_id), "synopsis": synopsis})
        self.assertEqual(admin_patch.await_count, 2)
        episode_update = admin_patch.await_args_list[0].args[2]
        self.assertEqual(episode_update["synopsis"], synopsis)
        saved_at = datetime.fromisoformat(episode_update["updated_at"])
        self.assertEqual(saved_at.utcoffset(), timezone.utc.utcoffset(saved_at))
        revision_update = admin_patch.await_args_list[1].args[2]
        self.assertEqual(revision_update, {"synopsis": synopsis})

    async def test_blank_synopsis_clears_guide_metadata(self):
        story_id = UUID("11111111-1111-4111-8111-111111111111")
        episode_id = UUID("22222222-2222-4222-8222-222222222222")
        user = AuthenticatedUser(
            id="44444444-4444-4444-8444-444444444444",
            email="author@example.test",
            access_token="test-token",
        )
        with (
            patch("app.api.routes.creator.require_story_editor", new_callable=AsyncMock),
            patch("app.api.routes.creator.supabase.admin_get", new_callable=AsyncMock) as admin_get,
            patch("app.api.routes.creator.supabase.admin_patch", new_callable=AsyncMock) as admin_patch,
        ):
            admin_get.return_value = [{"id": str(episode_id)}]
            await save_creator_episode_synopsis(
                story_id,
                episode_id,
                CreatorEpisodeSynopsisSubmission(synopsis="   "),
                user,
            )

        self.assertIsNone(admin_patch.await_args.args[2]["synopsis"])


if __name__ == "__main__":
    unittest.main()
