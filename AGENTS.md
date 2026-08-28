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

## Deterministic tax-position validation
- `backend/tax_validation/` is the versioned rule engine that grades AI-proposed deductions. The LLM may propose; the engine decides.
- `POST /api/validation/medical` — Pub. 502 medical-expense validator. Deterministic Decimal math: `max(0, paid_medical − reimbursements − AGI × approved_rate)`. Returns one of five statuses — `supported` (only via reviewer approval), `potentially_supported`, `unsupported`, `contradicted`, `outdated`, plus `human_review_required`. Medical is always HIGH risk, so the engine tops out at `potentially_supported`; only an authenticated reviewer can promote to `supported` and unblock filing (`filing_blocked` is true until then).
- Hallucination guards built in: rejects an LLM-supplied threshold rate that differs from the approved tax-year rule (`THRESHOLD_RATE_MISMATCH`), validates the AGI base, and refuses a definitive answer for a tax year with no approved rule (`outdated`).
- `GET /api/validation/rules/medical` — transparent versioned Pub. 502 threshold rules (2023–2025, 7.5%). The engine never trusts an LLM-supplied rate; it confirms against this registry.
- `GET /api/validation/medical/history` — append-only `validation_audit` records (sources, rule version, facts, flags, calculation, missing facts).
- Every validation writes an immutable `db.validation_audit` record and, when `review_required`, opens a human-review item in `db.review_items`.
- **Reviewer approval**: `POST /api/validation/medical/{claim_id}/decision` (`{decision: approve|reject, rationale}`). The reviewer is the authenticated user (identity bound to the session); the model cannot approve its own claims. Only a `potentially_supported` claim (all deterministic checks passed) can be approved — approving an unsupported/contradicted/outdated claim returns 409. Approval promotes the claim to `supported` and `filing_blocked=false`; rejection keeps `filing_blocked=true`. Re-validating the same `claim_id` with a changed material value appends a new validation event and re-blocks (re-review required on material change).
- `GET /api/validation/medical/{claim_id}` returns the effective state (the newest audit record for the claim).

## Tamper-evident audit trail
- `backend/tax_validation/audit.py` chains every `validation_audit` record cryptographically: each record stores `prev_hash` (previous tenant record's `record_hash`, or all-zero genesis) and `record_hash = sha256(prev_hash || canonical(payload))`. In-place edits/deletions/reorderings are detectable.
- `GET /api/audit/chain/verify` walks the active taxpayer's records in order and reports `valid`, `verified`/`total`, and `broken_at` (first index where the hash or link fails) plus per-record status. Verified: a clean validation+approval chain passes; flipping one record's `status` in-place makes `broken_at` point at it with `hash_ok=false`.
- Legacy (pre-chain) records carry no `record_hash`; chaining effectively (re)starts at the first new hashed record when the last tenant record predates the chain.

## Verification
- `curl -sf http://localhost:8000/api/` → `{"app":"TaxPilot AI","status":"ok"}`
- `curl -sf -H "Host: external.example" http://localhost:3000/` → HTML (Expo web).
- Frontend deps installed with `--ignore-scripts` (skips the project's cmd-guard preinstall hook + native builds; web-only target).
