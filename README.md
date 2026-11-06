# STORYFLICKS FastAPI backend

Python 3.11+ starter for the STORYFLICKS API.

## Setup

```bash
cd ~/storyflicks
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with the Supabase project URL, anon key and service-role key. Keep the service-role key on the backend only. Never commit `.env`.

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/health` and `http://127.0.0.1:8000/docs`.

## Endpoints

- `GET /health`
- `GET /api/stories`
- `GET /api/stories/{slug}`
- `GET /api/episodes/{episode_id}` (authenticated, entitlement checked)
- `POST /api/episodes/{episode_id}/reactions` (authenticated)
- `POST /api/episodes/{episode_id}/reviews` (authenticated)
- `GET /api/library` (authenticated)

Send `Authorization: Bearer <Supabase access token>` for authenticated routes.

The backend verifies tokens with Supabase Auth. It forwards the reader's own JWT to the reaction/review RPCs so PostgreSQL resolves `auth.uid()` as the reader. Controlled catalogue/library reads use the service-role key with user filters derived only from the verified identity.

This is a development foundation. Before production, add automated tests, rate limiting, structured logging, request IDs, deployment secrets, and a formal security review.
