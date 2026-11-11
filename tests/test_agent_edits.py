import copy
import unittest

from app.services import agent_edits as edits


def para(text, runs=None, **extra):
    block = {"type": "paragraph", "text": text, **extra}
    if runs is not None:
        block["runs"] = runs
    return block


class ReplaceInBlockTests(unittest.TestCase):
    def test_plain_block_is_replaced_once(self):
        result = edits.replace_in_block(para("The cat sat."), "cat", "dog")
        self.assertEqual(result["text"], "The dog sat.")
        self.assertNotIn("runs", result)

    def test_other_block_keys_are_kept(self):
        block = para("Hello world", align="center", indent=2)
        result = edits.replace_in_block(block, "world", "there")
        self.assertEqual((result["align"], result["indent"]), ("center", 2))

    def test_missing_text_is_rejected(self):
        with self.assertRaisesRegex(edits.EditError, "not found"):
            edits.replace_in_block(para("The cat sat."), "bird", "dog")

    def test_ambiguous_text_is_rejected_with_a_hint(self):
        with self.assertRaisesRegex(edits.EditError, "2 times"):
            edits.replace_in_block(para("go go go home"), "go go", "run")
        with self.assertRaisesRegex(edits.EditError, "3 times"):
            edits.replace_in_block(para("a a a"), "a", "b")

    def test_empty_old_text_is_rejected(self):
        with self.assertRaises(edits.EditError):
            edits.replace_in_block(para("text"), "", "x")

    def test_block_without_text_is_rejected(self):
        with self.assertRaises(edits.EditError):
            edits.replace_in_block({"type": "separator"}, "x", "y")

    def test_deleting_text_with_an_empty_replacement(self):
        result = edits.replace_in_block(para("Very good indeed."), "Very ", "")
        self.assertEqual(result["text"], "good indeed.")

    def test_input_block_is_not_modified(self):
        block = para("abc def", runs=[{"text": "abc "}, {"text": "def", "bold": True}])
        before = copy.deepcopy(block)
        edits.replace_in_block(block, "def", "xyz")
        self.assertEqual(block, before)


class RunPreservationTests(unittest.TestCase):
    def test_replacement_inside_one_run_keeps_that_runs_formatting(self):
        block = para(
            "She said hello loudly.",
            runs=[{"text": "She said "}, {"text": "hello", "italic": True}, {"text": " loudly."}],
        )
        result = edits.replace_in_block(block, "hello", "goodbye")
        self.assertEqual(result["text"], "She said goodbye loudly.")
        self.assertEqual(
            result["runs"],
            [{"text": "She said "}, {"text": "goodbye", "italic": True}, {"text": " loudly."}],
        )

    def test_edit_inside_a_run_splits_it_and_keeps_both_halves_formatted(self):
        block = para("Hello brave world", runs=[{"text": "Hello brave world", "bold": True}])
        result = edits.replace_in_block(block, "brave", "kind")
        self.assertEqual(result["text"], "Hello kind world")
        self.assertEqual(
            result["runs"],
            [{"text": "Hello ", "bold": True}, {"text": "kind", "bold": True}, {"text": " world", "bold": True}],
        )

    def test_edit_spanning_two_runs_takes_the_first_runs_formatting(self):
        block = para("ab cd", runs=[{"text": "ab ", "bold": True}, {"text": "cd", "italic": True}])
        result = edits.replace_in_block(block, "b c", "X")
        self.assertEqual(result["text"], "aXd")
        self.assertEqual(
            result["runs"],
            [{"text": "a", "bold": True}, {"text": "X", "bold": True}, {"text": "d", "italic": True}],
        )

    def test_deleting_a_whole_run_removes_it(self):
        block = para("one two three", runs=[{"text": "one "}, {"text": "two ", "bold": True}, {"text": "three"}])
        result = edits.replace_in_block(block, "two ", "")
        self.assertEqual(result["text"], "one three")
        self.assertEqual(result["runs"], [{"text": "one "}, {"text": "three"}])

    def test_replacing_a_whole_run_at_a_boundary_does_not_duplicate_text(self):
        block = para("AAABBB", runs=[{"text": "AAA", "bold": True}, {"text": "BBB"}])
        result = edits.replace_in_block(block, "AAA", "C")
        self.assertEqual(result["text"], "CBBB")
        self.assertEqual(result["runs"], [{"text": "C", "bold": True}, {"text": "BBB"}])

    def test_nested_formatting_keys_are_preserved(self):
        formatting = {"color": "#f00", "fontSizePt": 12}
        block = para("x target y", runs=[{"text": "x target y", "formatting": formatting}])
        result = edits.replace_in_block(block, "target", "goal")
        self.assertTrue(all(run["formatting"] == formatting for run in result["runs"]))
        result["runs"][0]["formatting"]["color"] = "changed"
        self.assertEqual(formatting["color"], "#f00", "runs must be copies, not shared references")

    def test_runs_that_do_not_match_the_text_are_dropped_but_text_is_kept(self):
        block = para("actual text", runs=[{"text": "stale"}])
        result = edits.replace_in_block(block, "actual", "new")
        self.assertEqual(result["text"], "new text")
        self.assertNotIn("runs", result)

    def test_combined_run_text_always_equals_block_text(self):
        block = para("a-b-c-d", runs=[{"text": "a-", "bold": True}, {"text": "b-c", "italic": True}, {"text": "-d"}])
        for old, new in (("a-b", "Z"), ("c-d", ""), ("-c-", "++"), ("a", "AAAA"), ("d", "")):
            with self.subTest(old=old):
                result = edits.replace_in_block(block, old, new)
                self.assertEqual("".join(run["text"] for run in result["runs"]), result["text"])


class ApplyEditsTests(unittest.TestCase):
    def setUp(self):
        self.content = {
            "version": 2,
            "blocks": [para("Chapter One"), para("The cat sat on the mat."), para("It was late.")],
        }

    def test_edits_apply_without_touching_the_original(self):
        original = copy.deepcopy(self.content)
        result = edits.apply_edits(
            self.content,
            [
                {"block_index": 1, "old_text": "cat", "new_text": "dog"},
                {"block_index": 2, "old_text": "late", "new_text": "early"},
            ],
        )
        self.assertEqual(self.content, original)
        self.assertEqual([b["text"] for b in result["blocks"]], ["Chapter One", "The dog sat on the mat.", "It was early."])
        self.assertEqual(result["version"], 2)

    def test_a_later_edit_sees_the_result_of_an_earlier_one(self):
        result = edits.apply_edits(
            self.content,
            [
                {"block_index": 1, "old_text": "cat", "new_text": "dog"},
                {"block_index": 1, "old_text": "dog sat", "new_text": "dog slept"},
            ],
        )
        self.assertEqual(result["blocks"][1]["text"], "The dog slept on the mat.")

    def test_one_bad_edit_fails_the_whole_set_and_names_it(self):
        with self.assertRaisesRegex(edits.EditError, r"Edit 2 \(block 2\)"):
            edits.apply_edits(
                self.content,
                [
                    {"block_index": 1, "old_text": "cat", "new_text": "dog"},
                    {"block_index": 2, "old_text": "missing", "new_text": "x"},
                ],
            )

    def test_block_index_out_of_range(self):
        with self.assertRaisesRegex(edits.EditError, "does not exist"):
            edits.apply_edits(self.content, [{"block_index": 9, "old_text": "a", "new_text": "b"}])

    def test_block_indexes_refer_to_the_blocks_the_assistant_was_shown(self):
        # Non-object entries are skipped when numbering blocks, so indexes
        # must stay aligned with the stored list.
        content = {"blocks": [para("first"), "junk", para("second")]}
        result = edits.apply_edits(content, [{"block_index": 1, "old_text": "second", "new_text": "2nd"}])
        self.assertEqual(result["blocks"], [para("first"), "junk", para("2nd")])


class ValidationAndHashTests(unittest.TestCase):
    def good(self, **overrides):
        return {"block_index": 0, "old_text": "a", "new_text": "b", "reason": "r", **overrides}

    def test_valid_edits_are_normalised(self):
        result = edits.validate_edits([self.good(reason="x" * 900)])
        self.assertEqual(len(result[0]["reason"]), 500)

    def test_invalid_shapes_are_rejected(self):
        bad_cases = [
            [],
            "nope",
            [123],
            [self.good(block_index=-1)],
            [self.good(block_index=True)],
            [self.good(block_index="1")],
            [self.good(old_text="")],
            [self.good(new_text=None)],
            [self.good(new_text="a")],
            [self.good(old_text="x" * (edits.MAX_EDIT_TEXT + 1))],
            [self.good() for _ in range(edits.MAX_EDITS_PER_PROPOSAL + 1)],
        ]
        for case in bad_cases:
            with self.subTest(case=str(case)[:60]), self.assertRaises(edits.EditError):
                edits.validate_edits(case)

    def test_hash_ignores_key_order_but_not_content(self):
        a = {"blocks": [{"type": "paragraph", "text": "x"}], "v": 1}
        b = {"v": 1, "blocks": [{"text": "x", "type": "paragraph"}]}
        self.assertEqual(edits.content_hash(a), edits.content_hash(b))
        self.assertNotEqual(edits.content_hash(a), edits.content_hash({**a, "v": 2}))

    def test_context_is_taken_from_around_the_match(self):
        content = {"blocks": [para("0123456789 TARGET abcdefghij")]}
        [enriched] = edits.add_context(content, [{"block_index": 0, "old_text": "TARGET", "new_text": "X", "reason": ""}])
        self.assertEqual(enriched["context_before"], "0123456789 ")
        self.assertEqual(enriched["context_after"], " abcdefghij")


if __name__ == "__main__":
    unittest.main()
