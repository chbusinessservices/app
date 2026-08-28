# Base44 Dev Environment — TaxPilot AI

## Stack
- **Frontend**: Expo (React Native) app served on web via `expo start --web` (Metro bundler). Runs on host port 3000.
- **Backend**: FastAPI (uvicorn, `server:app`) with MongoDB (motor). Runs on host port 8000.
- **Database**: MongoDB 7 (compose service `mongo`).

## Running
```
docker compose -f docker-compose.base44.yml up -d --build
```
Preview: host port 3000 (frontend). Backend API: host port 8000.

## Key setup notes
- The backend depends on `emergentintegrations` (private Emergent SDK, NOT on public PyPI). A local stub at `backend/emergentintegrations/` satisfies the import so the server boots. **LLM chat endpoints (`/api/chat`, the line-990 LLM feature) raise a runtime error** until the real package is installed. All MongoDB-backed CRUD/auth/deductions/compliance/handoff endpoints work without it.
- Document storage uses the Emergent object-store proxy (`integrations.emergentagent.com`) with `EMERGENT_LLM_KEY`. Storage init runs at startup in a try/except — if the key is invalid or the proxy unreachable, the server still boots (logs a warning) and document upload/retrieval will fail.
- **Secrets**: `EMERGENT_LLM_KEY` is managed via the Base44 secrets dashboard and delivered to `/run/base44/app.env`, wired into `backend` as the last `env_file:` so the dashboard value always wins over the `backend/.env` fallback (loaded by `load_dotenv` at runtime, which does not overwrite existing env vars). A working fallback key also lives in `backend/.env`. `JWT_SECRET` is app-internal (in `backend/.env`), not a dashboard secret.
- The backend `env_file` lists `/run/base44/app.env`; compose `environment:` only sets local-infra values (`MONGO_URL`, `DB_NAME`).

## Startup performance
- Both Dockerfiles use **BuildKit cache mounts** (`--mount=type=cache`) on pip and yarn installs, so dependency changes rebuild fast (downloaded wheels/packages persist across builds).
- Frontend sets `EXPO_NO_TELEMETRY=1`, `EXPO_NO_GIT_STATUS=1`, `EXPO_NO_UPDATE=1` to skip non-essential Expo startup work.
- Metro cache (`frontend/.metro-cache`, via `METRO_CACHE_ROOT` in `frontend/.env`) lives in the bind-mount, so it persists across container restarts.
- `backend` and `frontend` have healthchecks; `backend` waits for `mongo` to be healthy before starting. `frontend` only waits for `backend` to be *started* (not healthy) so the dev server can begin bundling in parallel.
- `fpdf2` is used lazily for handoff-PDF generation but was missing from `requirements.txt`; it is installed in the backend Dockerfile.
- Frontend `EXPO_PUBLIC_BACKEND_URL` is set via compose to `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}` so the web client reaches the backend's public origin. The backend has permissive CORS (`allow_origins=["*"]`).
- `MONGO_URL` is overridden in compose to `mongodb://mongo:27017` (the repo .env points at localhost).

## Verification
- `curl -sf http://localhost:8000/api/` → `{"app":"TaxPilot AI","status":"ok"}`
- `curl -sf -H "Host: external.example" http://localhost:3000/` → HTML (Expo web).
- Frontend deps installed with `--ignore-scripts` (skips the project's cmd-guard preinstall hook + native builds; web-only target).
