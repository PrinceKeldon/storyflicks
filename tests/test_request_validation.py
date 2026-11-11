import unittest

from pydantic import ValidationError

from app.api.routes.creator import (
    AuthorNoteSubmission,
    AuthorReplyBodySubmission,
    CreatorEpisodeSubmission,
    CreatorStorySubmission,
)
from app.api.routes.episodes import (
    ReactionSubmission,
    ReadingProgressSubmission,
    ReviewSubmission,
)
from app.api.routes.manuscript import ManuscriptAnalysisSubmission, ManuscriptChatSubmission, ManuscriptBlock
from app.api.routes.materials import MaterialSubmission


class CreatorRequestValidationTests(unittest.TestCase):
    def test_story_fields_are_bounded(self):
        with self.assertRaises(ValidationError):
            CreatorStorySubmission(title="x" * 161, slug="valid-slug")
        with self.assertRaises(ValidationError):
            CreatorStorySubmission(title="Valid", slug="Invalid Slug")
        with self.assertRaises(ValidationError):
            CreatorStorySubmission(title="Valid", slug="valid", synopsis="x" * 10001)

    def test_episode_content_size_and_shape_are_bounded(self):
        valid = {"sequence_number": 1, "title": "Pilot", "content": {"blocks": [
            {"type": "paragraph", "text": "Hello"}
        ]}}
        self.assertEqual(CreatorEpisodeSubmission(**valid).title, "Pilot")
        # These legacy types are still rendered by the Reading Room and must remain importable.
        for block_type in ("dialogue", "emphasis", "title", "divider", "scene_break"):
            with self.subTest(block_type=block_type):
                legacy = {**valid, "content": {"blocks": [{"type": block_type, "text": "Legacy"}]}}
                CreatorEpisodeSubmission(**legacy)
        with self.assertRaises(ValidationError):
            CreatorEpisodeSubmission(**{
                **valid, "content": {"blocks": [{"type": "script", "text": "No"}]}
            })
        with self.assertRaises(ValidationError):
            CreatorEpisodeSubmission(**{
                **valid, "content": {"blocks": [{"type": "paragraph", "text": "x" * 100001}]}
            })
        with self.assertRaises(ValidationError):
            CreatorEpisodeSubmission(**{
                **valid, "content": {"blocks": [
                    {"type": "paragraph", "text": "x" * 100000} for _ in range(22)
                ]}
            })

    def test_notes_and_replies_have_character_caps(self):
        with self.assertRaises(ValidationError):
            AuthorNoteSubmission(
                story_id="00000000-0000-0000-0000-000000000001",
                body="x" * 50001, action="draft",
            )
        with self.assertRaises(ValidationError):
            AuthorReplyBodySubmission(body="x" * 10001)


    def test_manuscript_analysis_and_chat_requests_are_bounded(self):
        block = {"type": "paragraph", "text": "A manuscript paragraph."}
        self.assertEqual(len(ManuscriptBlock(type="paragraph", text="x" * 6000).text), 6000)
        analysis = ManuscriptAnalysisSubmission(
            story_title="A Story",
            blocks=[block],
            author_instructions="Keep the prologue separate.",
        )
        self.assertEqual(analysis.author_instructions, "Keep the prologue separate.")
        with self.assertRaises(ValidationError):
            ManuscriptAnalysisSubmission(
                story_title="A Story",
                blocks=[block],
                author_instructions="x" * 4001,
            )

        chat = ManuscriptChatSubmission(
            story_title="A Story",
            message="Please explain the chapter boundaries.",
            blocks=[block],
            history=[{"role": "user", "text": "Keep the prologue separate."}],
        )
        self.assertEqual(chat.history[0].role, "user")
        with self.assertRaises(ValidationError):
            ManuscriptChatSubmission(story_title="A Story", message=" ")
        with self.assertRaises(ValidationError):
            ManuscriptChatSubmission(
                story_title="A Story",
                message="Hello",
                history=[{"role": "assistant", "text": "Not an allowed Gemini role."}],
            )
        with self.assertRaises(ValidationError):
            ManuscriptChatSubmission(
                story_title="A Story",
                message="Hello",
                history=[{"role": "user", "text": "x" * 2001}],
            )

    def test_story_material_sections_are_bounded_and_typed(self):
        valid = MaterialSubmission(
            title="Dedication",
            section_type="dedication",
            placement="front_matter",
            content={"blocks": [{"type": "paragraph", "text": "For my family."}]},
        )
        self.assertEqual(valid.placement, "front_matter")
        with self.assertRaises(ValidationError):
            MaterialSubmission(title=" ", placement="front_matter")
        with self.assertRaises(ValidationError):
            MaterialSubmission(title="Unknown", section_type="chapter", placement="front_matter")
        with self.assertRaises(ValidationError):
            MaterialSubmission(title="Too large", placement="back_matter", content={"text": "x" * (2 * 1024 * 1024)})

    def test_reader_contributions_have_character_caps(self):
        self.assertEqual(len(ReviewSubmission(body="A review").body), 8)
        with self.assertRaises(ValidationError):
            ReviewSubmission(body="x" * 20001)
        with self.assertRaises(ValidationError):
            ReactionSubmission(reaction_codes=["x" * 65])
        with self.assertRaises(ValidationError):
            ReadingProgressSubmission(
                progress_percent=50,
                last_position={"position": "x" * 9000},
            )


if __name__ == "__main__":
    unittest.main()
