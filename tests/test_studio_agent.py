import asyncio
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from app.api.routes import studio_agent
from app.core.security import AuthenticatedUser
from app.services import agent_loop, agent_tools
from app.services import agent_edits

USER = AuthenticatedUser(id=str(uuid4()), email="a@example.com", access_token="tok")
STORY, OTHER_STORY, EP, OTHER_EP = (str(uuid4()) for _ in range(4))
REV = str(uuid4())


def run(coro):
    return asyncio.run(coro)


def para(text):
    return {"type": "paragraph", "text": text}


class FakeDB:
    def __init__(self):
        self.tables = {
            "creator_profiles": [{"id": USER.id, "status": "active"}],
            "story_creators": [{"story_id": STORY, "creator_id": USER.id, "role": "owner"}],
            "stories": [{"id": STORY, "title": "S", "deleted_at": None}],
            "episodes": [
                {"id": EP, "story_id": STORY, "season_id": None, "sequence_number": 1, "title": "One",
                 "publication_status": "published", "deleted_at": None},
                {"id": OTHER_EP, "story_id": OTHER_STORY, "season_id": None, "sequence_number": 1, "title": "X",
                 "publication_status": "draft", "deleted_at": None},
            ],
            "episode_revisions": [
                {"id": REV, "episode_id": EP, "revision_number": 1, "title": "One", "synopsis": "s",
                 "revision_status": "published",
                 "content": {"blocks": [para("The cat sat."), para("It was late.")]}},
            ],
            "studio_agent_conversations": [], "studio_agent_messages": [], "studio_agent_proposals": [],
        }
        self.rpc_calls = []

    @staticmethod
    def _match(row, params):
        for key, cond in params.items():
            if key in ("select", "order", "limit", "offset"):
                continue
            value = row.get(key)
            if cond.startswith("eq."):
                if str(value) != cond[3:]:
                    return False
            elif cond == "is.null":
                if value is not None:
                    return False
            elif cond.startswith("in."):
                if str(value) not in cond[4:-1].split(","):
                    return False
        return True

    async def admin_get(self, table, params=None):
        params = params or {}
        rows = [dict(r) for r in self.tables[table] if self._match(r, params)]
        if params.get("order", "").endswith(".desc"):
            col = params["order"].rsplit(".", 1)[0]
            rows.sort(key=lambda r: r.get(col) or 0, reverse=True)
        if "limit" in params:
            rows = rows[: int(params["limit"])]
        return rows

    admin_get_all = admin_get

    async def admin_insert(self, table, payload):
        self.tables[table].append(dict(payload))

    async def admin_patch(self, table, params, payload):
        for r in self.tables[table]:
            if self._match(r, params):
                r.update(payload)

    async def admin_patch_returning(self, table, params, payload):
        out = []
        for r in self.tables[table]:
            if self._match(r, params):
                r.update(payload)
                out.append(dict(r))
        return out

    async def user_rpc(self, name, payload, token):
        self.rpc_calls.append((name, payload))
        if name != "save_creator_episode":
            return {}
        revs = self.tables["episode_revisions"]
        revs.append({"id": str(uuid4()), "episode_id": payload["p_episode_id"],
                     "revision_number": max(r["revision_number"] for r in revs) + 1,
                     "title": payload["p_title"], "synopsis": payload["p_synopsis"],
                     "revision_status": "draft", "content": payload["p_content"]})
        return {}


class Base(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        patches = [patch.object(agent_tools, "supabase", self.db), patch.object(studio_agent, "supabase", self.db)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.ctx = agent_tools.AgentContext(user=USER, conversation_id=str(uuid4()), story_id=STORY)

    def propose(self, **over):
        args = {"episode_id": EP, "title": "Fix", "rationale": "r",
                "edits": [{"block_index": 0, "old_text": "cat", "new_text": "dog"}], **over}
        return run(agent_tools.run_tool(self.ctx, "propose_episode_edit", args))


class ToolTests(Base):
    def test_other_authors_chapter_is_not_readable(self):
        result = run(agent_tools.run_tool(self.ctx, "get_episode_text", {"episode_id": OTHER_EP}))
        self.assertIn("error", result)

    def test_other_authors_story_is_not_searchable(self):
        result = run(agent_tools.run_tool(self.ctx, "search_manuscript", {"story_id": OTHER_STORY, "query": "cat"}))
        self.assertIn("error", result)

    def test_read_chapter_shows_indexed_blocks(self):
        result = run(agent_tools.run_tool(self.ctx, "get_episode_text", {"episode_id": EP}))
        self.assertEqual([b["block_index"] for b in result["blocks"]], [0, 1])
        self.assertIsNone(result["next_start_block"])

    def test_search_finds_text_across_chapters(self):
        result = run(agent_tools.run_tool(self.ctx, "search_manuscript", {"story_id": STORY, "query": "LATE"}))
        self.assertEqual(result["total_matches"], 1)
        self.assertEqual(result["matches"][0]["block_index"], 1)

    def test_proposal_is_stored_pending_and_chapter_unchanged(self):
        result = self.propose()
        self.assertEqual(result["status"], "pending_author_approval")
        [row] = self.db.tables["studio_agent_proposals"]
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["payload"]["base_revision_id"], REV)
        self.assertEqual(self.db.tables["episode_revisions"][0]["content"]["blocks"][0]["text"], "The cat sat.")
        self.assertEqual(len(self.ctx.proposals), 1)

    def test_proposal_that_does_not_apply_is_rejected_with_a_reason(self):
        result = self.propose(edits=[{"block_index": 0, "old_text": "bird", "new_text": "x"}])
        self.assertIn("not found", result["error"])
        self.assertEqual(self.db.tables["studio_agent_proposals"], [])

    def test_proposal_on_foreign_chapter_is_refused(self):
        self.assertIn("error", self.propose(episode_id=OTHER_EP))
        self.assertEqual(self.db.tables["studio_agent_proposals"], [])

    def test_unknown_tool_and_bad_args_do_not_raise(self):
        self.assertIn("error", run(agent_tools.run_tool(self.ctx, "delete_everything", {})))
        self.assertIn("error", run(agent_tools.run_tool(self.ctx, "get_episode_text", {"episode_id": "nope"})))
        self.assertIn("error", run(agent_tools.run_tool(self.ctx, "get_episode_text", None)))

    def test_web_research_returns_deduplicated_sources(self):
        async def fake(payload, *, purpose, **kw):
            self.assertEqual(payload["tools"], [{"google_search": {}}])
            return {"candidates": [{"content": {"parts": [{"text": "Answer."}]},
                                    "groundingMetadata": {"groundingChunks": [
                                        {"web": {"uri": "https://a.example/x", "title": "A"}},
                                        {"web": {"uri": "https://a.example/x", "title": "A"}},
                                        {"web": {"uri": "javascript:alert(1)", "title": "bad"}}]}}]}
        with patch.object(agent_tools, "generate_content", fake):
            result = run(agent_tools.run_tool(self.ctx, "web_research", {"query": "genre trends"}))
        self.assertEqual(result["sources"], [{"title": "A", "url": "https://a.example/x"}])
        self.assertEqual(self.ctx.sources, result["sources"])


class LoopTests(Base):
    def test_tool_call_round_trip_then_final_answer(self):
        seen = []

        async def fake(payload, *, purpose, **kw):
            seen.append(payload)
            if len(seen) == 1:
                return {"_model": "m", "candidates": [{"content": {"role": "model", "parts": [
                    {"functionCall": {"name": "get_episode_text", "args": {"episode_id": EP}, "id": "c1"}}]}}]}
            return {"_model": "m", "candidates": [{"content": {"parts": [{"text": "Done."}]}}]}

        with patch.object(agent_loop, "generate_content", fake):
            reply, model = run(agent_loop.run_agent(self.ctx, [], "read chapter 1"))
        self.assertEqual((reply, model), ("Done.", "m"))
        last = seen[1]["contents"][-1]["parts"][0]["functionResponse"]
        self.assertEqual((last["name"], last["id"]), ("get_episode_text", "c1"))
        self.assertIn("The cat sat.", str(last["response"]))
        self.assertEqual(len(self.ctx.activity), 1)

    def test_loop_stops_after_the_round_limit(self):
        calls = []

        async def fake(payload, *, purpose, **kw):
            calls.append(payload)
            if "tools" in payload:
                return {"candidates": [{"content": {"parts": [
                    {"functionCall": {"name": "list_stories", "args": {}}}]}}]}
            return {"candidates": [{"content": {"parts": [{"text": "Summary."}]}}]}

        with patch.object(agent_loop, "generate_content", fake), patch.object(agent_loop.settings, "agent_max_tool_rounds", 3):
            reply, _ = run(agent_loop.run_agent(self.ctx, [], "go"))
        self.assertEqual(reply, "Summary.")
        self.assertEqual(len(calls), 4)


class ApprovalTests(Base):
    def setUp(self):
        super().setUp()
        self.propose()
        self.pid = self.db.tables["studio_agent_proposals"][0]["id"]
        p = patch.object(studio_agent, "require_story_editor", self._ok)
        p.start()
        self.addCleanup(p.stop)

    async def _ok(self, story_id, user):
        return None

    def approve(self):
        return run(studio_agent.approve_proposal(self.pid, USER))

    def test_approve_saves_a_new_draft_revision(self):
        result = self.approve()
        self.assertEqual(result["status"], "applied")
        [(name, payload)] = self.db.rpc_calls
        self.assertEqual(name, "save_creator_episode")
        self.assertEqual(payload["p_content"]["blocks"][0]["text"], "The dog sat.")
        self.assertEqual(self.db.tables["studio_agent_proposals"][0]["status"], "applied")
        self.assertEqual(self.db.tables["episode_revisions"][0]["content"]["blocks"][0]["text"], "The cat sat.")

    def test_second_approval_conflicts_and_does_not_save_twice(self):
        self.approve()
        with self.assertRaises(HTTPException) as cm:
            self.approve()
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(len(self.db.rpc_calls), 1)

    def test_changed_chapter_makes_proposal_stale(self):
        self.db.tables["episode_revisions"].append(
            {"id": str(uuid4()), "episode_id": EP, "revision_number": 2, "title": "One", "synopsis": "s",
             "revision_status": "draft", "content": {"blocks": [para("The cat sat."), para("New.")]}})
        with self.assertRaises(HTTPException) as cm:
            self.approve()
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(self.db.tables["studio_agent_proposals"][0]["status"], "stale")
        self.assertEqual(self.db.rpc_calls, [])

    def test_reject_then_approve_fails(self):
        run(studio_agent.reject_proposal(self.pid, USER))
        with self.assertRaises(HTTPException):
            self.approve()
        self.assertEqual(self.db.rpc_calls, [])

    def test_someone_elses_proposal_is_not_found(self):
        stranger = AuthenticatedUser(id=str(uuid4()), email=None, access_token="t")
        with self.assertRaises(HTTPException) as cm:
            run(studio_agent.approve_proposal(self.pid, stranger))
        self.assertEqual(cm.exception.status_code, 404)

    def test_failed_save_marks_proposal_failed(self):
        async def boom(*a, **k):
            raise HTTPException(502, "db down")
        self.db.user_rpc = boom
        with self.assertRaises(HTTPException):
            self.approve()
        self.assertEqual(self.db.tables["studio_agent_proposals"][0]["status"], "failed")


class ChatTests(Base):
    def test_chat_persists_messages_and_enforces_daily_limit(self):
        async def fake_run(ctx, history, message):
            return "Hello", "m"
        with patch.object(studio_agent, "run_agent", fake_run), \
             patch.object(studio_agent.settings, "agent_daily_message_limit", 1):
            body = studio_agent.AgentChatRequest(message="hi", story_id=STORY)
            out = run(studio_agent.agent_chat(body, USER))
            self.assertEqual(out["reply"], "Hello")
            self.assertEqual([m["role"] for m in self.db.tables["studio_agent_messages"]], ["user", "model"])
            with self.assertRaises(HTTPException) as cm:
                run(studio_agent.agent_chat(body, USER))
            self.assertEqual(cm.exception.status_code, 429)

    def test_chat_with_foreign_story_is_forbidden(self):
        body = studio_agent.AgentChatRequest(message="hi", story_id=OTHER_STORY)
        with self.assertRaises(HTTPException) as cm:
            run(studio_agent.agent_chat(body, USER))
        self.assertEqual(cm.exception.status_code, 403)


EP2, REVIEW = str(uuid4()), str(uuid4())


class ReplyAndRenumberTests(Base):
    def setUp(self):
        super().setUp()
        self.db.tables["episodes"].append(
            {"id": EP2, "story_id": STORY, "season_id": None, "sequence_number": 2, "title": "Two",
             "publication_status": "draft", "deleted_at": None})
        self.db.tables["reviews"] = [
            {"id": REVIEW, "episode_id": EP, "status": "submitted", "visibility": "public",
             "headline": "Great", "body": "Loved it."},
            {"id": str(uuid4()), "episode_id": OTHER_EP, "status": "submitted", "visibility": "public",
             "headline": "x", "body": "y"},
        ]
        self.rpcs = []

        async def admin_rpc(name, payload):
            self.rpcs.append((name, payload))
            return 2
        self.db.admin_rpc = admin_rpc
        p = patch.object(studio_agent, "require_story_editor", self._ok)
        p.start()
        self.addCleanup(p.stop)

    async def _ok(self, story_id, user):
        return None

    def tool(self, name, args):
        return run(agent_tools.run_tool(self.ctx, name, args))

    def swap(self, **over):
        return self.tool("propose_chapter_renumber", {"story_id": STORY, "moves": [
            {"episode_id": EP, "new_sequence_number": 2}, {"episode_id": EP2, "new_sequence_number": 1}], **over})

    def test_reply_is_a_pending_proposal_and_posts_nothing(self):
        result = self.tool("propose_review_reply", {"review_id": REVIEW, "body": "Thank you!"})
        self.assertEqual(result["status"], "pending_author_approval")
        [row] = self.db.tables["studio_agent_proposals"]
        self.assertEqual((row["kind"], row["status"], row["payload"]["body"]), ("review_reply", "pending", "Thank you!"))
        self.assertEqual(self.db.rpc_calls, [])

    def test_reply_to_a_foreign_or_missing_review_is_refused(self):
        foreign = self.db.tables["reviews"][1]["id"]
        self.assertIn("error", self.tool("propose_review_reply", {"review_id": foreign, "body": "hi"}))
        self.assertIn("error", self.tool("propose_review_reply", {"review_id": str(uuid4()), "body": "hi"}))
        self.assertIn("error", self.tool("propose_review_reply", {"review_id": REVIEW, "body": "  "}))
        self.assertEqual(self.db.tables["studio_agent_proposals"], [])

    def test_approving_a_reply_posts_it_with_the_users_token(self):
        self.tool("propose_review_reply", {"review_id": REVIEW, "body": "Thank you!"})
        pid = self.db.tables["studio_agent_proposals"][0]["id"]
        out = run(studio_agent.approve_proposal(pid, USER))
        self.assertEqual(out["status"], "applied")
        self.assertEqual(self.db.rpc_calls, [("publish_author_reply", {"p_review_id": REVIEW, "p_body": "Thank you!"})])

    def test_swap_is_proposed_with_both_chapters(self):
        self.assertEqual(self.swap()["status"], "pending_author_approval")
        [row] = self.db.tables["studio_agent_proposals"]
        self.assertEqual([(c["from_number"], c["to_number"]) for c in row["payload"]["changes"]], [(2, 1), (1, 2)])
        self.assertIsNone(row["episode_id"])
        self.assertEqual(self.rpcs, [])

    def test_bad_renumbers_are_refused(self):
        cases = [
            [{"episode_id": EP, "new_sequence_number": 2}],  # collides with chapter two
            [{"episode_id": EP, "new_sequence_number": 5}, {"episode_id": EP2, "new_sequence_number": 5}],
            [{"episode_id": EP, "new_sequence_number": 0}],
            [{"episode_id": EP, "new_sequence_number": 1}],  # no change
            [{"episode_id": OTHER_EP, "new_sequence_number": 9}],  # someone else's chapter
            [{"episode_id": EP, "new_sequence_number": 3}, {"episode_id": EP, "new_sequence_number": 4}],
        ]
        for moves in cases:
            with self.subTest(moves=moves):
                self.assertIn("error", self.tool("propose_chapter_renumber", {"story_id": STORY, "moves": moves}))
        self.assertEqual(self.db.tables["studio_agent_proposals"], [])

    def test_approving_a_renumber_calls_the_atomic_function(self):
        self.swap()
        pid = self.db.tables["studio_agent_proposals"][0]["id"]
        out = run(studio_agent.approve_proposal(pid, USER))
        self.assertEqual(out["status"], "applied")
        [(name, payload)] = self.rpcs
        self.assertEqual(name, "apply_agent_chapter_renumber")
        self.assertEqual(
            {m["episode_id"]: (m["from_sequence_number"], m["sequence_number"]) for m in payload["p_moves"]},
            {EP: (1, 2), EP2: (2, 1)},
        )

    def test_database_recheck_can_reject_a_stale_renumber_atomically(self):
        self.swap()
        pid = self.db.tables["studio_agent_proposals"][0]["id"]

        async def stale_rpc(name, payload):
            self.rpcs.append((name, payload))
            return -1  # SQL detected a changed number after taking row locks.

        self.db.admin_rpc = stale_rpc
        with self.assertRaises(HTTPException) as cm:
            run(studio_agent.approve_proposal(pid, USER))
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(self.db.tables["studio_agent_proposals"][0]["status"], "stale")
        self.assertEqual(self.rpcs[0][1]["p_moves"][0]["from_sequence_number"], 2)

    def test_renumber_goes_stale_if_numbers_changed(self):
        self.swap()
        pid = self.db.tables["studio_agent_proposals"][0]["id"]
        next(e for e in self.db.tables["episodes"] if e["id"] == EP2).update(sequence_number=7)  # EP2 renumbered meanwhile
        with self.assertRaises(HTTPException) as cm:
            run(studio_agent.approve_proposal(pid, USER))
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(self.db.tables["studio_agent_proposals"][0]["status"], "stale")
        self.assertEqual(self.rpcs, [])


if __name__ == "__main__":
    unittest.main()
