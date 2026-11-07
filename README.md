# STORYFLICKS

STORYFLICKS is an entertainment platform built around episodic stories. The repository contains a Python FastAPI backend and a Next.js App Router frontend in `frontend/`.

## Stack

- FastAPI / Python
- Supabase PostgreSQL, Auth, and Storage
- Supabase Auth access tokens for reader and creator authentication
- Vercel (frontend hosting)
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
- `STORY_ASSETS_BUCKET` — storage bucket name; defaults to `story-assets`

Keep `.env`, `.reader_token`, and virtual environments out of Git.

## Run the frontend

```bash
cd ~/storyflicks/frontend
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Set `NEXT_PUBLIC_API_URL` to the FastAPI base URL (for local development, `http://127.0.0.1:8000/api`). Only public Supabase URL/anon-key values may be exposed to the browser; never add the service-role key to frontend environment variables.

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
- `POST /api/creator/stories/{story_id}/publish`
- `PATCH /api/creator/stories/{story_id}/completion-status`
- `POST /api/creator/stories/{story_id}/assets/upload-url`
- `POST /api/creator/stories/{story_id}/assets/complete`
- `GET /api/creator/stories/{story_id}/assets`
- `GET /api/creator/episodes/{episode_id}/revisions`
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

The repository contains the FastAPI backend and a reproducible Supabase schema baseline:

- `supabase/migrations/20261107000100_initial_schema.sql` contains the exported public schema, database functions, grants/revokes, the auth-user profile trigger, the `story-assets` bucket definition, and the initial reaction catalogue.
- The baseline migration is recorded as applied in the linked development project's migration history. A dry-run `supabase db push --dry-run --linked` confirmed that the remote database was up to date at the time of verification.
- `supabase/schema.sql` is the accompanying schema snapshot. The archived creator-publication migration is retained for historical reference and is not an active migration.

**Important:** schema migrations reproduce database structure and database logic; they do not reproduce live user accounts, story records, manuscript content, or uploaded storage objects. The development data for THE PRIEST is backed up separately in a local `creator_backup.json` file. That file and the `backups/` directory are intentionally excluded from Git because they may contain unpublished manuscript material. Never commit manuscript backups, Supabase secrets, access tokens, or private user data.

The THE PRIEST data export currently preserves its story record, creator profile and assignment, all 12 episode records, the two published manuscript bodies and their published revisions, and publication history. It does not contain the original cover image bytes or unrelated reader activity. Restoring creator ownership requires the corresponding Supabase Auth user to exist, or an explicit creator-ID mapping during restore.

The frontend now includes Discover, THE PRIEST story detail/episode guide, Supabase email/password sign-in and registration, an authenticated Reading Room, the episode contribution screen, the reader-facing Review Room, My Library, and a connected Creator Studio. Creator Studio includes creator dashboard totals, multi-story catalogue and workspace selection, story metadata editing and publication, episode drafting with ordered paragraph/heading/quote blocks, plain-text manuscript import, reading preview, story-cover and episode-image uploads, revision history, immediate or scheduled episode publication, completion status, aggregate audience/insight views, author communications and moderation. At episode end, readers can select editorial reactions or submit a written review (public or private); either qualifying contribution unlocks the next episode through the existing database RPCs. The Review Room shows public reviews only, reaction tags and community summaries, helpful-vote controls, author replies, published author notes, episode navigation limited to episodes the reader can access, and Featured / Newest / Most helpful sorting. Review text and author replies are individually spoiler-gated. Helpful-vote endpoints validate public review status and episode access before forwarding the user JWT to the database RPC. Private reviews remain visible only to their author in the contribution flow. My Library now includes Continue Reading, On Your List, Caught Up and Completed shelves, a Saved shelf with bookmark removal, and a My Contributions view for the reader’s reviews and reactions. Story detail pages include a save-to-library control. Creator Studio UI is now implemented against the existing creator API. The Community workspace supports author-note drafting, publishing, scheduling, pinning and withdrawal; a creator-only inbox of public submitted reviews with author replies; and a moderation queue for reports with review, resolve, dismiss and resolve-and-hide actions. Creator Settings now connects notification preferences. Private reader reviews are excluded from the creator review inbox. Remaining work includes richer event-level analytics, automated tests, a committed npm lockfile, and production deployment configuration. End-to-end testing is intentionally deferred until the frontend and backend are both complete. Until then, use compile/static checks and schema/API contract review.
