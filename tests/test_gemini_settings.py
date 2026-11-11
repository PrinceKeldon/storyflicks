import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.core.config import Settings
from app.services import gemini


class GeminiSettingsTests(unittest.TestCase):
    def test_key_and_model_are_loaded_from_a_dotenv_file(self):
        """The original bug: .env values never reached os.getenv."""
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "SUPABASE_URL=https://example.supabase.co\n"
                "SUPABASE_ANON_KEY=a\n"
                "SUPABASE_SERVICE_ROLE_KEY=b\n"
                "GEMINI_API_KEY=key-from-dotenv\n"
                "GEMINI_MODEL=model-from-dotenv\n"
            )
            with patch.dict(os.environ, {}, clear=True):
                loaded = Settings(_env_file=env_file)
                self.assertNotIn("GEMINI_API_KEY", os.environ)

        self.assertEqual(loaded.gemini_api_key, "key-from-dotenv")
        self.assertEqual(loaded.gemini_model, "model-from-dotenv")


class FakeResponse:
    status_code = 200
    is_success = True

    def __init__(self, text: str):
        self._text = text

    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": self._text}]}}]}


def fake_client(recorder: dict, reply: str):
    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def post(self, url, headers=None, json=None):
            recorder["url"] = url
            recorder["headers"] = headers
            return FakeResponse(reply)

    return FakeClient


class GeminiServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_ai_function_reports_unconfigured_when_the_key_is_empty(self):
        calls = (
            lambda: gemini.analyse_manuscript_structure([{"type": "paragraph", "text": "x"}], "T"),
            lambda: gemini.chat_about_manuscript("T", "hi", [], []),
            lambda: gemini.propose_manuscript_patch("T", "S", "text", "tighten this"),
        )
        with patch.object(gemini.settings, "gemini_api_key", ""):
            for call in calls:
                with self.assertRaises(HTTPException) as caught:
                    await call()
                self.assertEqual(caught.exception.status_code, 503)

    async def test_configured_key_and_model_are_sent_to_gemini(self):
        sent: dict = {}
        with (
            patch.object(gemini.settings, "gemini_api_key", "  key-123  "),
            patch.object(gemini.settings, "gemini_model", "test-model"),
            patch.object(gemini.httpx, "AsyncClient", fake_client(sent, "A reply.")),
        ):
            result = await gemini.chat_about_manuscript("Title", "hello", [], [])

        self.assertEqual(result, {"reply": "A reply.", "model": "test-model"})
        self.assertEqual(sent["headers"], {"x-goog-api-key": "key-123"})
        self.assertIn("/models/test-model:generateContent", sent["url"])


if __name__ == "__main__":
    unittest.main()
