"""TaxPilot AI backend API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://mobile-app-preview-695.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def creds():
    # Unique test user per run
    return {
        "email": f"TEST_taxpilot_{uuid.uuid4().hex[:8]}@example.com",
        "password": "Secret123!",
        "name": "Test User"
    }


@pytest.fixture(scope="module")
def auth(client, creds):
    r = client.post(f"{API}/auth/signup", json=creds)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    body = r.json()
    assert "session_token" in body and "user" in body
    token = body["session_token"]
    return {"token": token, "user": body["user"], "headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


# --- Auth ---
class TestAuth:
    def test_login_wrong_pw(self, client, creds):
        r = client.post(f"{API}/auth/login", json={"email": creds["email"], "password": "wrong"})
        assert r.status_code == 401

    def test_login_success(self, client, creds, auth):
        r = client.post(f"{API}/auth/login", json={"email": creds["email"], "password": creds["password"]})
        assert r.status_code == 200
        assert r.json()["user"]["email"] == creds["email"].lower()

    def test_me(self, client, auth):
        r = client.get(f"{API}/auth/me", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["email"] == auth["user"]["email"]

    def test_me_unauth(self, client):
        r = client.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_signup_duplicate(self, client, creds):
        r = client.post(f"{API}/auth/signup", json=creds)
        assert r.status_code == 400


# --- Demo Seed & Documents ---
class TestDemoAndDocuments:
    def test_demo_seed(self, client, auth):
        r = client.post(f"{API}/demo/seed", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["seeded"] == 4

    def test_list_documents(self, client, auth):
        r = client.get(f"{API}/documents", headers=auth["headers"])
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) >= 4
        types = {d["doc_type"] for d in docs}
        assert {"W-2", "1099-NEC", "Receipt", "K-1"}.issubset(types)

    def test_get_single_document(self, client, auth):
        docs = client.get(f"{API}/documents", headers=auth["headers"]).json()
        did = docs[0]["document_id"]
        r = client.get(f"{API}/documents/{did}", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["document_id"] == did

    def test_get_missing_document(self, client, auth):
        r = client.get(f"{API}/documents/nonexistent", headers=auth["headers"])
        assert r.status_code == 404


# --- Extraction ---
class TestExtraction:
    def test_extract_claude(self, client, auth):
        docs = client.get(f"{API}/documents", headers=auth["headers"]).json()
        # pick a W-2
        w2 = next(d for d in docs if d["doc_type"] == "W-2")
        r = client.post(f"{API}/documents/{w2['document_id']}/extract?model=claude-sonnet-5", headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert "fields" in data and len(data["fields"]) > 0
        assert all("confidence" in f for f in data["fields"])

    def test_extract_gpt(self, client, auth):
        docs = client.get(f"{API}/documents", headers=auth["headers"]).json()
        nec = next(d for d in docs if d["doc_type"] == "1099-NEC")
        r = client.post(f"{API}/documents/{nec['document_id']}/extract?model=gpt-5.4", headers=auth["headers"])
        assert r.status_code == 200, r.text
        assert "fields" in r.json()


# --- Review Queue ---
class TestReviewQueue:
    def test_list_review(self, client, auth):
        r = client.get(f"{API}/review-queue", headers=auth["headers"])
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_acknowledge(self, client, auth):
        items = client.get(f"{API}/review-queue", headers=auth["headers"]).json()
        rid = items[0]["review_id"]
        r = client.post(f"{API}/review-queue/{rid}/action", headers=auth["headers"], json={"action": "acknowledge"})
        assert r.status_code == 200
        assert r.json()["status"] == "resolved"

    def test_skip(self, client, auth):
        items = client.get(f"{API}/review-queue", headers=auth["headers"]).json()
        if not items:
            pytest.skip("no items to skip")
        rid = items[0]["review_id"]
        r = client.post(f"{API}/review-queue/{rid}/action", headers=auth["headers"], json={"action": "skip"})
        assert r.status_code == 200
        assert r.json()["status"] == "skipped"


# --- Pipeline & Deductions ---
class TestPipelineDeductions:
    def test_return_status(self, client, auth):
        r = client.get(f"{API}/return/status", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert len(body["steps"]) == 7
        assert "counts" in body

    def test_deductions(self, client, auth):
        r = client.get(f"{API}/deductions", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert "suggestions" in body and "missing" in body
        assert len(body["suggestions"]) >= 1
