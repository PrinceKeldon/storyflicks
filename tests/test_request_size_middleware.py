import unittest

from app.core.middleware import RequestSizeLimitMiddleware


class RequestSizeLimitMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_oversized_content_length_without_reading_body(self):
        async def app(scope, receive, send):
            self.fail("Application must not run for a declared oversized body.")

        messages = []
        async def receive():
            self.fail("Body must not be read for a declared oversized body.")

        async def send(message):
            messages.append(message)

        middleware = RequestSizeLimitMiddleware(app, max_bytes=10)
        await middleware(
            {"type": "http", "headers": [(b"content-length", b"11")]},
            receive,
            send,
        )
        self.assertEqual(messages[0]["status"], 413)

    async def test_rejects_oversized_streamed_body(self):
        chunks = [
            {"type": "http.request", "body": b"x" * 8, "more_body": True},
            {"type": "http.request", "body": b"y" * 8, "more_body": False},
        ]
        async def receive():
            return chunks.pop(0)

        messages = []
        async def send(message):
            messages.append(message)

        async def app(scope, receive, send):
            await receive()
            await receive()
            await send({"type": "http.response.start", "status": 200, "headers": []})

        middleware = RequestSizeLimitMiddleware(app, max_bytes=10)
        await middleware({"type": "http", "headers": []}, receive, send)
        self.assertEqual(messages[0]["status"], 413)


if __name__ == "__main__":
    unittest.main()
