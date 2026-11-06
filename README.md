# STORYFLICKS

STORYFLICKS is an episodic storytelling platform. This repository currently contains the Python FastAPI backend. The Next.js frontend has not yet been added.

## Stack

- FastAPI / Python
- Supabase PostgreSQL, Auth, and Storage
- Supabase Auth access tokens for reader and creator authentication
- Vercel (planned frontend hosting)
- Render (planned API hosting and scheduled publishing worker)

## Local setup

Use Python 3.11 or newer.

```bash
cd ~/storyflicks
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

Configure the following values in `.env`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — backend only; never expose this to the browser
- `CORS_ORIGINS` — JSON array of allowed frontend origins
- `SCHEDULER_SECRET` — long random secret shared only by the API and scheduled job

Keep `.env`, `.reader_token`, and virtual environments out of Git.

## Run the API

```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- Health: http://127.0.0.1:8000/health
- OpenAPI / Swagger: http://127.0.0.1:8000/docs

Authenticated endpoints require:

```
Authorization: Bearer <Supabase access token>
```

The API validates the access token with Supabase Auth. Reader/creator RPC calls forward the user's own JWT so PostgreSQL resolves `auth.uid()` correctly. Privileged REST reads use the service-role key only from the backend and apply user/story filters in the route logic. The service-role key must never be sent to the frontend.

## API surface

### Public catalogue

- `GET /api/stories`
- `GET /api/stories/{slug}`

### Reading and engagement

- `GET /api/episodes/{episode_id}`
- `PUT /api/episodes/{episode_id}/progress`
- `POST /api/episodes/{episode_id}/reactions`
- `POST /api/episodes/{episode_id}/reviews`
- `GET /api/episodes/{episode_id}/review-room`

### Reader library and community

- `GET /api/library`
- `POST /api/library/bookmarks/{story_id}`
- `DELETE /api/library/bookmarks/{story_id}`
- `GET /api/library/preferences`
- `PUT /api/library/preferences`
- `POST /api/reviews/{review_id}/helpful`
- `DELETE /api/reviews/{review_id}/helpful`
- `POST /api/reports`

### Notifications

- `GET /api/notifications`
- `PATCH /api/notifications/{notification_id}/read`
- `PATCH /api/notifications/read-all`
- `GET /api/notifications/preferences`
- `PUT /api/notifications/preferences`

### Creator Studio

- `GET /api/creator/dashboard`
- `POST /api/creator/stories`
- `PUT /api/creator/stories/{story_id}`
- `GET /api/creator/stories/{story_id}/workspace`
- `POST /api/creator/stories/{story_id}/episodes`
- `PUT /api/creator/stories/{story_id}/episodes/{episode_id}`
- `POST /api/creator/episodes/{episode_id}/publication`
- `GET /api/creator/author-notes`
- `POST /api/creator/author-notes`
- `PATCH /api/creator/author-notes/{note_id}/pin`
- `POST /api/creator/reviews/reply`
- `POST /api/creator/reviews/{review_id}/reply`
- `GET /api/creator/moderation/reports`
- `PATCH /api/creator/moderation/reports/{report_id}`

### Internal scheduled publishing

These endpoints require the scheduler bearer secret and must not be called by browsers:

- `POST /api/internal/publish-due-author-notes`
- `POST /api/internal/publish-due-episodes`

The scheduled worker can be run with:

```bash
python -m app.jobs.publish_due_author_notes
```

Set `STORYFLICKS_API_URL` and `SCHEDULER_SECRET` in the worker environment.

## Current implementation status

The repository contains the FastAPI backend and its route modules. The frontend, automated test suite, deployment configuration, and checked-in Supabase migration history are not yet present.

The database functions and schema have been applied to the Supabase project during development, but their SQL migration files still need to be captured in this repository so a fresh environment can be reproduced reliably.

End-to-end testing is intentionally deferred until the frontend and backend are both complete. Until then, use compile/static checks and schema/API contract review.
