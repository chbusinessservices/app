"""Tests for iteration 3 features: sources registry, preferences (tax_year),
§7216 consent, handoff PDF, chat tax_year echo."""
import base64
import os
import uuid

import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(client):
    email = f"TEST_iter3_{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup",
                    json={"email": email, "password": "Secret123!", "name": "I3"})
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    return {"email": email,
            "headers": {"Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"}}


# ---------- Source Registry ----------
class TestSources:
    def test_returns_eight_entries_with_shape(self, client, auth):
        r = client.get(f"{API}/sources", headers=auth["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert "sources" in body
        assert len(body["sources"]) == 8
        approved = [s for s in body["sources"] if s["status"] == "approved"]
        superseded = [s for s in body["sources"] if s["status"] == "superseded"]
        assert len(approved) == 7
        assert len(superseded) == 1
        # verify each has required fields
        for s in body["sources"]:
            for k in ("source_id", "publication", "revision",
                      "revision_date", "hash", "official_url", "tax_years", "status"):
                assert k in s, f"missing {k} in {s.get('source_id')}"
            assert s["hash"].startswith("sha256:")
            assert s["official_url"].startswith("https://www.irs.gov")
            assert isinstance(s["tax_years"], list) and len(s["tax_years"]) > 0


# ---------- Preferences ----------
class TestPreferences:
    def test_get_defaults_for_fresh_user(self, client, auth):
        r = client.get(f"{API}/preferences", headers=auth["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tax_year"] == 2025
        assert body["consent_7216"] is False
        assert body["cpa_email"] is None
        assert body["consent_7216_at"] is None
        assert body["consent_7216_revoked_at"] is None

    def test_post_updates_tax_year(self, client, auth):
        r = client.post(f"{API}/preferences",
                        headers=auth["headers"],
                        json={"tax_year": 2024})
        assert r.status_code == 200
        assert r.json()["tax_year"] == 2024
        # persisted?
        got = client.get(f"{API}/preferences", headers=auth["headers"]).json()
        assert got["tax_year"] == 2024

    def test_post_rejects_invalid_tax_year(self, client, auth):
        r = client.post(f"{API}/preferences",
                        headers=auth["headers"],
                        json={"tax_year": 2020})
        assert r.status_code == 400

    def test_post_persists_cpa_email(self, client, auth):
        r = client.post(f"{API}/preferences",
                        headers=auth["headers"],
                        json={"cpa_email": "cpa@firm.com"})
        assert r.status_code == 200
        assert r.json()["cpa_email"] == "cpa@firm.com"
        # ensure tax_year unchanged from prior test
        assert r.json()["tax_year"] == 2024


# ---------- §7216 Consent ----------
class TestConsent:
    def test_sign_requires_signed_name_and_accept(self, client, auth):
        # accept=false rejected
        r = client.post(f"{API}/consent/7216",
                        headers=auth["headers"],
                        json={"signed_name": "Jane Doe", "accept": False})
        assert r.status_code == 400
        # blank signed_name rejected
        r = client.post(f"{API}/consent/7216",
                        headers=auth["headers"],
                        json={"signed_name": "   ", "accept": True})
        assert r.status_code == 400

    def test_sign_success_updates_prefs(self, client, auth):
        r = client.post(f"{API}/consent/7216",
                        headers=auth["headers"],
                        json={"signed_name": "Jane Doe", "accept": True})
        assert r.status_code == 200
        body = r.json()
        assert body["consent_7216"] is True
        assert body["consent_7216_at"] is not None
        assert body["consent_7216_revoked_at"] is None

    def test_revoke_clears_consent(self, client, auth):
        r = client.post(f"{API}/consent/7216/revoke", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["consent_7216"] is False
        assert body["consent_7216_revoked_at"] is not None


# ---------- Reviewer Handoff PDF ----------
class TestHandoffPDF:
    def test_generate_pdf_for_known_item(self, client, auth):
        r = client.post(f"{API}/handoff/home_office/pdf",
                        headers=auth["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert "filename" in body and body["filename"].endswith(".pdf")
        assert "pdf_base64" in body
        pdf_bytes = base64.b64decode(body["pdf_base64"])
        assert pdf_bytes[:4] == b"%PDF", "not a real PDF"
        assert len(pdf_bytes) > 500
        assert "cpa_email" in body

    def test_unknown_item_returns_404(self, client, auth):
        r = client.post(f"{API}/handoff/nonexistent/pdf",
                        headers=auth["headers"])
        assert r.status_code == 404


# ---------- Chat with tax_year ----------
class TestChatTaxYear:
    def test_chat_echoes_tax_year(self, client, auth):
        r = client.post(f"{API}/chat",
                        headers=auth["headers"],
                        json={"message": "What is the standard deduction?",
                              "tax_year": 2023})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("tax_year") == 2023
