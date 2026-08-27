"""Security-verification tests for SEC-001, SEC-002, SEC-003 fixes.

SEC-001 (CRITICAL): /api/auth/apple must ignore req.email and only trust
                    token['email'] when token['email_verified'] is True.
SEC-002 (MEDIUM):   /api/documents/{id}/file must reject ?token=... query
                    auth; only accept Authorization: Bearer.
SEC-003 (MEDIUM):   /api/documents/upload must enforce size/ext/empty rules,
                    /api/chat must enforce empty/length rules.
"""
import io
import os
import re
import uuid

import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def auth(client):
    email = f"TEST_sec_{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup",
                    json={"email": email, "password": "Secret123!", "name": "Sec"})
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    return {"email": email,
            "token": token,
            "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="module")
def second_user(client):
    """Second, isolated user for cross-account access tests."""
    email = f"TEST_sec2_{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup",
                    json={"email": email, "password": "Secret123!", "name": "Sec2"})
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    return {"email": email, "token": token,
            "headers": {"Authorization": f"Bearer {token}"}}


# ==========================================================================
# SEC-001: /auth/apple must not trust req.email
# ==========================================================================
class TestSEC001AppleAuth:
    def test_invalid_token_returns_401(self, client):
        """Syntactically invalid token -> 401 (not 500, not 200)."""
        r = client.post(f"{API}/auth/apple",
                        json={"identity_token": "not-a-jwt",
                              "email": "attacker@example.com"})
        assert r.status_code == 401, r.text

    def test_malformed_jwt_returns_401(self, client):
        """A three-segment string that isn't a real JWT -> 401."""
        r = client.post(f"{API}/auth/apple",
                        json={"identity_token": "aaa.bbb.ccc",
                              "email": "victim@example.com"})
        assert r.status_code == 401, r.text

    def test_missing_token_returns_422(self, client):
        r = client.post(f"{API}/auth/apple", json={})
        assert r.status_code == 422

    def test_code_inspection_req_email_not_used_for_lookup(self):
        """Static-inspect /app/backend/server.py: the apple_signin function
        must NOT use req.email for lookup/linking and MUST check email_verified.
        """
        path = "/app/backend/server.py"
        with open(path) as f:
            src = f.read()

        # Extract the apple_signin function body
        m = re.search(
            r"async def apple_signin\(req: AppleSignInRequest\).*?(?=\n@api_router|\ndef |\nclass )",
            src, re.DOTALL)
        assert m, "apple_signin function not found"
        body = m.group(0)

        # (a) req.email must NOT appear in executable code (only comments)
        for i, line in enumerate(body.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            assert "req.email" not in stripped, (
                f"req.email used in executable code at apple_signin line {i}: {stripped!r}"
            )

        # (b) email_verified claim MUST be checked before trusting email
        assert "email_verified" in body, "email_verified claim not checked"
        assert re.search(r"claims\.get\(['\"]email_verified['\"]\)", body), \
            "email_verified must be read from token claims"

        # (c) When looking up by email, guard on verified_email (truthy only when verified)
        assert re.search(r"if\s+not\s+existing\s+and\s+verified_email", body), \
            "must guard email-based lookup on verified_email"


# ==========================================================================
# SEC-002: /documents/{id}/file must only accept Authorization header
# ==========================================================================
class TestSEC002DocumentFile:
    @pytest.fixture(scope="class")
    def seeded_doc_id(self, client, auth):
        r = client.post(f"{API}/demo/seed", headers=auth["headers"])
        assert r.status_code == 200, r.text
        docs = client.get(f"{API}/documents", headers=auth["headers"]).json()
        assert docs, "seed produced no docs"
        return docs[0]["document_id"]

    def test_query_token_rejected_401(self, client, auth, seeded_doc_id):
        """?token=<valid> WITHOUT Authorization header MUST be rejected."""
        # No Authorization header at all
        r = requests.get(f"{API}/documents/{seeded_doc_id}/file",
                         params={"token": auth["token"]})
        assert r.status_code == 401, (
            f"expected 401 when using ?token= without Bearer header, got {r.status_code}: {r.text}"
        )

    def test_no_auth_rejected_401(self, client, seeded_doc_id):
        r = requests.get(f"{API}/documents/{seeded_doc_id}/file")
        assert r.status_code == 401

    def test_bearer_header_accepted_404_no_storage(self, client, auth, seeded_doc_id):
        """Seed docs have no storage_path -> 404 with valid Bearer header
        (proves auth passed and endpoint reached the file-fetch branch)."""
        r = requests.get(f"{API}/documents/{seeded_doc_id}/file",
                         headers=auth["headers"])
        # Must NOT be 401 with valid Bearer
        assert r.status_code != 401, "valid Bearer should not be rejected"
        # Seed docs have no storage_path -> 404
        assert r.status_code == 404, f"expected 404 for seed doc (no storage_path), got {r.status_code}"

    def test_cross_user_isolation(self, client, auth, second_user, seeded_doc_id):
        """User B must not see User A's document."""
        r = requests.get(f"{API}/documents/{seeded_doc_id}/file",
                         headers=second_user["headers"])
        assert r.status_code == 404, f"cross-user access must 404, got {r.status_code}"

    def test_cross_taxpayer_isolation(self, client, auth, seeded_doc_id):
        """Docs uploaded under Self must not be visible after switching to Spouse."""
        # Create spouse taxpayer
        r = requests.post(f"{API}/taxpayers",
                          headers={**auth["headers"], "Content-Type": "application/json"},
                          json={"name": "Spouse", "relationship": "spouse"})
        assert r.status_code == 200, r.text
        spouse_id = r.json()["taxpayer_id"]

        # Activate spouse
        r = requests.post(f"{API}/taxpayers/{spouse_id}/activate",
                          headers=auth["headers"])
        assert r.status_code == 200

        # Try to access self's document while active tp = spouse -> 404
        r = requests.get(f"{API}/documents/{seeded_doc_id}/file",
                         headers=auth["headers"])
        assert r.status_code == 404, f"cross-taxpayer access must 404, got {r.status_code}"

        # Cleanup: switch back to self
        tps = requests.get(f"{API}/taxpayers", headers=auth["headers"]).json()
        self_tp = next(t for t in tps if t.get("relationship") == "self")
        requests.post(f"{API}/taxpayers/{self_tp['taxpayer_id']}/activate",
                      headers=auth["headers"])


# ==========================================================================
# SEC-003: /documents/upload + /chat input validation
# ==========================================================================
class TestSEC003Uploads:
    def test_reject_exe_extension_400(self, client, auth):
        files = {"file": ("evil.exe", b"MZ\x90\x00" + b"A" * 100,
                          "application/octet-stream")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 400, r.text
        assert "Unsupported" in r.text or "allowed" in r.text.lower()

    def test_reject_sh_extension_400(self, client, auth):
        files = {"file": ("payload.sh", b"#!/bin/bash\nrm -rf /", "text/x-sh")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 400

    def test_reject_empty_file_400(self, client, auth):
        files = {"file": ("empty.pdf", b"", "application/pdf")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 400, r.text
        assert "empty" in r.text.lower()

    def test_reject_too_large_413(self, client, auth):
        # 25 MiB + 1 byte
        oversized = b"A" * (25 * 1024 * 1024 + 1)
        files = {"file": ("big.pdf", oversized, "application/pdf")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 413, f"expected 413 for >25MiB, got {r.status_code}"

    def test_accept_valid_pdf_200(self, client, auth):
        # Minimal syntactically-valid-ish PDF
        pdf_bytes = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\n%%EOF"
        files = {"file": ("return.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["doc_type"] in ("Auto", "Other", "W-2", "1099-NEC",
                                    "1099-INT", "1099-DIV", "K-1", "Receipt",
                                    "Prior-Year Return")
        assert "document_id" in body

    def test_accept_valid_jpg_200(self, client, auth):
        files = {"file": ("receipt.jpg", b"\xff\xd8\xff\xe0" + b"A" * 200,
                          "image/jpeg")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 200, r.text

    def test_accept_valid_xlsx_200(self, client, auth):
        files = {"file": ("data.xlsx", b"PK\x03\x04" + b"A" * 200,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/documents/upload",
                          headers=auth["headers"], files=files)
        assert r.status_code == 200


class TestSEC003Chat:
    def test_reject_empty_message_400(self, client, auth):
        r = requests.post(f"{API}/chat",
                          headers={**auth["headers"], "Content-Type": "application/json"},
                          json={"message": ""})
        assert r.status_code == 400

    def test_reject_whitespace_only_400(self, client, auth):
        r = requests.post(f"{API}/chat",
                          headers={**auth["headers"], "Content-Type": "application/json"},
                          json={"message": "   \n\t  "})
        assert r.status_code == 400

    def test_reject_too_long_400(self, client, auth):
        r = requests.post(f"{API}/chat",
                          headers={**auth["headers"], "Content-Type": "application/json"},
                          json={"message": "x" * 4001})
        assert r.status_code == 400, r.text
        assert "too long" in r.text.lower() or "4000" in r.text

    def test_accept_boundary_length_200(self, client, auth):
        """4000 chars exactly should be accepted."""
        r = requests.post(f"{API}/chat",
                          headers={**auth["headers"], "Content-Type": "application/json"},
                          json={"message": "What is the standard deduction? " + ("x" * (4000 - 32))})
        # This will call LLM - accept 200 or 500 (LLM failure) but NOT 400
        assert r.status_code != 400, f"boundary length 4000 must not be rejected, got {r.status_code}"

    def test_accept_short_message_200(self, client, auth):
        r = requests.post(f"{API}/chat",
                          headers={**auth["headers"], "Content-Type": "application/json"},
                          json={"message": "What IRS publication covers home office?"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "answer" in body
