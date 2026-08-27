# TaxPilot AI — Mobile App PRD

**Vision**: A secure AI tax agent (mobile) that turns raw tax documents into a filed return with minimal human effort — humans stay in control for risky items. Mirrors the reference site (captured-11cbf452691a7c0e36c84f773-61f16ad3.base44.app).

## Users
Individual tax filers and preparers. Roles: preparer, reviewer, admin (RBAC displayed in Profile).

## Core Features
1. **Auth** — Email/password (bcrypt + JWT-style session tokens, 7-day expiry) + Emergent Google OAuth.
2. **Dashboard** — Return draft progress (7-step pipeline: Collect → Understand → Infer → Draft → Review → File → Audit), quick actions (Upload, Review Queue, Demo, Vault), savings/time stats.
3. **Document Vault** — Filter by type (W-2, 1099-NEC, 1099-INT, K-1, Receipt, etc.), status pills, tap into detail.
4. **Upload** — Camera scan, photo picker, file picker. Persists via Emergent Managed Object Storage.
5. **AI Extraction** — Auto-runs on upload with Claude Sonnet 5 (default) or GPT 5.4 (selectable). Structured JSON with field-level confidence scores. Low-confidence fields flagged.
6. **Review Queue** — Human-in-the-loop items (low confidence, missing docs) with Acknowledge/Skip actions.
7. **Deductions & Missing docs** — Rule-based suggestions based on doc types present.
8. **Interactive Demo** — 4-step guided walkthrough with sample data; final step seeds sample data into the user's account.
9. **Profile / Compliance** — WISP, §7216 consent, audit log, encryption, retention, incident response info.

## Tech Stack
- **Backend**: FastAPI + MongoDB (motor). Endpoints prefixed `/api`.
- **Frontend**: Expo Router (SDK 54), React Native. Bottom tabs (Home, Vault, Review, Profile).
- **Integrations**: Emergent LLM Key (Claude Sonnet 5, GPT 5.4), Emergent Object Storage, Emergent Google Auth.
- **Design**: Sage Green (#3D5A46) + Warm Sand (#F7F6F2), iOS-Native Clean personality, glassmorphism hero card.

## Data Models
- `users` — user_id (unique), email (unique), name, picture, password_hash?, role, created_at
- `user_sessions` — session_token, user_id, created_at, expires_at (TTL)
- `documents` — document_id, user_id, filename, doc_type, status, storage_path, content_type, uploaded_at, extraction?
- `review_items` — review_id, user_id, document_id?, title, reason, severity, status, created_at

## Key Endpoints
- Auth: `/api/auth/{signup,login,session,me,logout}`
- Documents: `/api/documents` (list), `/api/documents/upload`, `/api/documents/{id}`, `/api/documents/{id}/extract?model=`, `/api/documents/{id}/file`
- Review: `/api/review-queue`, `/api/review-queue/{id}/action`
- Return: `/api/return/status`, `/api/deductions`
- Demo: `/api/demo/seed`
