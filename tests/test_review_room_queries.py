import typing
import unittest
from uuid import UUID, uuid4

from app.api.routes import episodes


class FakeSupabase:
    """Records admin_get_all calls and returns one row per requested ID."""

    def __init__(self):
        self.calls: list[tuple[str, dict[str, str]]] = []

    async def admin_get_all(self, table, params=None, page_size=500):
        params = params or {}
        self.calls.append((table, params))
        in_filter = params["review_id"]
        ids = in_filter.removeprefix("in.(").removesuffix(")").split(",")
        return [{"review_id": review_id} for review_id in ids]


class AdminGetInTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fake = FakeSupabase()
        self._original = episodes.supabase
        episodes.supabase = self.fake

    def tearDown(self):
        episodes.supabase = self._original

    async def test_large_id_lists_are_split_into_bounded_requests(self):
        ids = [str(uuid4()) for _ in range(250)]

        rows = await episodes.admin_get_in(
            "review_helpful_votes", "review_id", ids, {"select": "review_id"}
        )

        self.assertEqual(len(self.fake.calls), 3)
        for _, params in self.fake.calls:
            chunk = params["review_id"].removeprefix("in.(").removesuffix(")").split(",")
            self.assertLessEqual(len(chunk), episodes.IN_FILTER_CHUNK_SIZE)
            self.assertEqual(params["select"], "review_id")
        self.assertEqual([row["review_id"] for row in rows], ids)

    async def test_duplicate_ids_are_requested_once(self):
        review_id = str(uuid4())

        rows = await episodes.admin_get_in(
            "review_helpful_votes", "review_id", [review_id, review_id], {}
        )

        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(len(rows), 1)

    async def test_empty_id_list_makes_no_requests(self):
        rows = await episodes.admin_get_in("review_helpful_votes", "review_id", [], {})

        self.assertEqual(rows, [])
        self.assertEqual(self.fake.calls, [])


class ReviewRoomRouteTests(unittest.TestCase):
    def test_episode_id_path_parameter_is_a_uuid(self):
        hints = typing.get_type_hints(episodes.get_review_room)
        self.assertIs(hints["episode_id"], UUID)


if __name__ == "__main__":
    unittest.main()
