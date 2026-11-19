import unittest
from types import SimpleNamespace

from app.api.routes import library


def matches(row, params):
    for key, cond in params.items():
        if key in ("select", "order", "limit", "offset") or key not in row:
            continue
        if cond.startswith("eq.") and str(row[key]) != cond[3:]:
            return False
        if cond.startswith("in.(") and str(row[key]) not in cond[4:-1].split(","):
            return False
    return True


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables
        self.in_sizes = []

    async def admin_get_all(self, table, params=None, page_size=500):
        params = params or {}
        for cond in params.values():
            if cond.startswith("in.("):
                self.in_sizes.append(len(cond[4:-1].split(",")))
        return [r for r in self.tables.get(table, []) if matches(r, params)]

    admin_get = admin_get_all


def build(count):
    stories, episodes, bookmarks = [], [], []
    for i in range(count):
        sid = f"s{i:03d}"
        stories.append({"id": sid, "slug": sid, "title": sid, "publication_status": "published",
                        "completion_status": "ongoing", "cover_path": None})
        episodes.append({"id": f"e{i:03d}", "story_id": sid, "sequence_number": 1, "title": "One",
                         "publication_status": "published"})
        bookmarks.append({"story_id": sid, "user_id": "u1", "created_at": f"2026-01-{(i % 28) + 1:02d}"})
    return {"bookmarks": bookmarks, "stories": stories, "episodes": episodes}


class LibraryPaginationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original = library.supabase
        self.user = SimpleNamespace(id="u1")

    def tearDown(self):
        library.supabase = self.original

    async def test_default_returns_first_page_with_totals(self):
        library.supabase = FakeSupabase(build(30))
        data = await library.get_library(user=self.user, shelf=None, offset=0, limit=12)
        self.assertEqual(len(data["not_started"]), 12)
        self.assertEqual(data["totals"]["not_started"], 30)
        self.assertTrue(data["has_more"]["not_started"])
        self.assertEqual(data["totals"]["saved"], 30)
        self.assertEqual(data["story_total"], 30)

    async def test_shelf_paging_covers_everything_without_overlap(self):
        library.supabase = FakeSupabase(build(30))
        seen, offset = [], 0
        while True:
            page = await library.get_library(user=self.user, shelf="saved", offset=offset, limit=12)
            seen += [c["story"]["id"] for c in page["items"]]
            if not page["has_more"]:
                break
            offset += 12
        self.assertEqual(len(seen), 30)
        self.assertEqual(len(set(seen)), 30)

    async def test_large_id_lists_are_chunked(self):
        fake = FakeSupabase(build(250))
        library.supabase = fake
        data = await library.get_library(user=self.user, shelf=None, offset=0, limit=12)
        self.assertEqual(data["totals"]["saved"], 250)
        self.assertLessEqual(max(fake.in_sizes), library.ID_CHUNK)

    async def test_empty_library(self):
        library.supabase = FakeSupabase({})
        data = await library.get_library(user=self.user, shelf=None, offset=0, limit=12)
        self.assertEqual(data["story_total"], 0)
        self.assertFalse(any(data["has_more"].values()))


if __name__ == "__main__":
    unittest.main()
