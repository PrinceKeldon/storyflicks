import unittest

from fastapi import HTTPException

from app.api.routes import episodes

STORY = {"id": "s1", "slug": "the-priest", "title": "The Priest", "publication_status": "published",
         "first_episode_free": True, "section_label": "Episode", "section_label_plural": "Episodes"}


def episode(seq, status="published", eid=None):
    return {"id": eid or f"e{seq}", "story_id": "s1", "sequence_number": seq, "title": f"Ep {seq}",
            "synopsis": "S", "content": [{"type": "paragraph", "text": "Hello"}],
            "publication_status": status, "published_at": None}


class FakeSupabase:
    def __init__(self, story, eps):
        self.story, self.eps = story, eps
        self.touched_user_tables = []

    async def admin_get(self, table, params=None):
        params = params or {}
        if table == "episodes":
            wanted = params.get("id", "")[3:]
            return [e for e in self.eps if e["id"] == wanted]
        if table == "stories":
            return [self.story]
        if table in ("reading_progress", "episode_entitlements", "episode_participations"):
            self.touched_user_tables.append(table)
        return []

    async def admin_get_all(self, table, params=None, page_size=500):
        return [{"id": e["id"], "title": e["title"], "sequence_number": e["sequence_number"],
                 "publication_status": e["publication_status"]} for e in self.eps]


class OpenSampleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original = episodes.supabase

    def tearDown(self):
        episodes.supabase = self.original

    async def read(self, seq, story=None, eps=None, status="published"):
        eps = eps or [episode(1), episode(2)]
        for e in eps:
            if e["sequence_number"] == seq:
                e["publication_status"] = status
        fake = FakeSupabase(story or dict(STORY), eps)
        episodes.supabase = fake
        target = next(e for e in eps if e["sequence_number"] == seq)
        # read_episode expects a UUID, but only formats it into the query; the fake matches on the id string.
        return await episodes.read_episode(target["id"], user=None), fake

    async def test_anonymous_can_read_free_first_episode(self):
        payload, fake = await self.read(1)
        self.assertTrue(payload["sample"])
        self.assertEqual(payload["episode"]["content"][0]["text"], "Hello")
        self.assertEqual(payload["next_episode"]["sequence_number"], 2)
        self.assertIsNone(payload["previous_episode"])
        self.assertIsNone(payload["reading_progress"])
        self.assertEqual(fake.touched_user_tables, [])

    async def test_anonymous_cannot_read_later_episodes(self):
        with self.assertRaises(HTTPException) as ctx:
            await self.read(2)
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_anonymous_blocked_when_first_episode_not_free(self):
        with self.assertRaises(HTTPException) as ctx:
            await self.read(1, story={**STORY, "first_episode_free": False})
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_anonymous_blocked_for_unpublished_sample(self):
        with self.assertRaises(HTTPException) as ctx:
            await self.read(1, status="draft")
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_anonymous_blocked_for_unpublished_story(self):
        with self.assertRaises(HTTPException) as ctx:
            await self.read(1, story={**STORY, "publication_status": "draft"})
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
