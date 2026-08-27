"""Tests for iteration 4 features:
  1) Prior-Year Diff Viewer (/api/rules/diff)
  2) CPA Directory (/api/cpas)
  3) Handoff Tracking (/api/handoffs, /api/handoffs/{id}/status)
  4) Multi-Taxpayer Vault (/api/taxpayers CRUD + activate + isolation)
"""
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


def _signup(client):
    email = f"TEST_iter4_{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup",
                    json={"email": email, "password": "Secret123!", "name": "I4"})
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    return {"email": email,
            "headers": {"Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"}}


@pytest.fixture(scope="module")
def auth(client):
    return _signup(client)


# ---------- Prior-Year Diff Viewer ----------
class TestRulesDiff:
    def test_diff_2025_to_2024_has_4_changed_out_of_7(self, client, auth):
        r = client.get(f"{API}/rules/diff?from_year=2025&to_year=2024",
                       headers=auth["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["from_year"] == 2025
        assert body["to_year"] == 2024
        changes = body["changes"]
        assert len(changes) == 7
        changed = [c for c in changes if c["change"] == "changed"]
        unchanged = [c for c in changes if c["change"] == "unchanged"]
        assert len(changed) == 4, f"expected 4 changed, got {len(changed)}: {[c['rule_id'] for c in changed]}"
        assert len(unchanged) == 3
        changed_ids = {c["rule_id"] for c in changed}
        assert "std-ded-single" in changed_ids
        assert "std-ded-mfj" in changed_ids
        assert "mileage-business" in changed_ids
        assert "savers-credit-agi-single" in changed_ids
        # every changed row has from_value != to_value and both non-null
        for c in changed:
            assert c["from_value"] and c["to_value"]
            assert c["from_value"] != c["to_value"]

    def test_diff_2023_to_2025_all_shape_ok(self, client, auth):
        r = client.get(f"{API}/rules/diff?from_year=2023&to_year=2025",
                       headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert len(body["changes"]) == 7
        # Same-year -> everything unchanged
        r2 = client.get(f"{API}/rules/diff?from_year=2024&to_year=2024",
                        headers=auth["headers"])
        assert r2.status_code == 200
        assert all(c["change"] == "unchanged" for c in r2.json()["changes"])

    def test_diff_invalid_year_returns_400(self, client, auth):
        r = client.get(f"{API}/rules/diff?from_year=2020&to_year=2024",
                       headers=auth["headers"])
        assert r.status_code == 400
        r2 = client.get(f"{API}/rules/diff?from_year=2024&to_year=2030",
                        headers=auth["headers"])
        assert r2.status_code == 400


# ---------- CPA Directory ----------
class TestCPADirectory:
    def test_unfiltered_returns_12(self, client, auth):
        r = client.get(f"{API}/cpas", headers=auth["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 12
        assert len(body["cpas"]) == 12
        # required fields
        for c in body["cpas"]:
            for k in ("cpa_id", "name", "firm", "email", "license_state",
                      "credentials", "specialties"):
                assert k in c

    def test_search_state_ca_returns_two(self, client, auth):
        r = client.get(f"{API}/cpas?q=CA", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 2
        names = {c["name"] for c in body["cpas"]}
        assert "Jamie Chen, CPA" in names
        assert "Grace Lin, CPA" in names

    def test_search_by_name(self, client, auth):
        r = client.get(f"{API}/cpas?q=Priya", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["count"] == 1
        assert r.json()["cpas"][0]["name"].startswith("Priya")

    def test_search_by_firm(self, client, auth):
        r = client.get(f"{API}/cpas?q=Fischer", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["count"] == 1
        assert r.json()["cpas"][0]["firm"] == "Fischer & Ross"

    def test_search_by_specialty(self, client, auth):
        r = client.get(f"{API}/cpas?q=Crypto", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        assert any("Crypto" in c["specialties"] for c in body["cpas"])


# ---------- Handoff Tracking + Multi-Taxpayer Vault ----------
class TestTaxpayersAndHandoffs:
    def test_lazy_self_taxpayer_on_first_list(self, client):
        a = _signup(client)
        r = client.get(f"{API}/taxpayers", headers=a["headers"])
        assert r.status_code == 200, r.text
        items = r.json()
        assert len(items) == 1
        assert items[0]["relationship"] == "self"
        # active state is tracked via /preferences.active_taxpayer_id
        prefs = client.get(f"{API}/preferences", headers=a["headers"]).json()
        assert prefs["active_taxpayer_id"] == items[0]["taxpayer_id"]

    def test_full_taxpayer_lifecycle_and_isolation(self, client):
        a = _signup(client)

        # Seed data for self
        seed = client.post(f"{API}/demo/seed", headers=a["headers"])
        assert seed.status_code == 200

        docs = client.get(f"{API}/documents", headers=a["headers"]).json()
        self_docs_count = len(docs)
        assert self_docs_count >= 4, f"expected >=4 seeded docs, got {self_docs_count}"

        # Create spouse taxpayer
        r = client.post(f"{API}/taxpayers", headers=a["headers"],
                        json={"name": "Test Spouse", "relationship": "spouse"})
        assert r.status_code == 200, r.text
        spouse = r.json()
        assert spouse["relationship"] == "spouse"
        spouse_id = spouse["taxpayer_id"]

        # Activate spouse
        r = client.post(f"{API}/taxpayers/{spouse_id}/activate",
                        headers=a["headers"])
        assert r.status_code == 200
        assert r.json().get("active_taxpayer_id") == spouse_id

        # Spouse should have 0 docs (isolated)
        spouse_docs = client.get(f"{API}/documents", headers=a["headers"]).json()
        assert len(spouse_docs) == 0, f"spouse should have 0 docs, got {len(spouse_docs)}"

        # Do a disposition as spouse to create a handoff-generating event pathway
        r = client.post(f"{API}/potential-items/home_office/disposition",
                        headers=a["headers"],
                        json={"disposition": "save_for_pro_review"})
        assert r.status_code == 200, r.text

        # Generate handoff PDF as spouse (this creates a handoff_audit entry)
        r = client.post(f"{API}/handoff/home_office/pdf", headers=a["headers"])
        assert r.status_code == 200, r.text

        # Handoffs should show 1 for spouse
        hs = client.get(f"{API}/handoffs", headers=a["headers"]).json()
        assert len(hs["handoffs"]) == 1
        h = hs["handoffs"][0]
        assert h.get("status", "generated") == "generated"
        handoff_id = h["handoff_id"]

        # Update status invalid -> 400
        r = client.post(f"{API}/handoffs/{handoff_id}/status",
                        headers=a["headers"], json={"status": "bogus"})
        assert r.status_code == 400

        # Update status shared -> 200
        r = client.post(f"{API}/handoffs/{handoff_id}/status",
                        headers=a["headers"],
                        json={"status": "shared", "comment": "sent"})
        assert r.status_code == 200
        assert r.json()["status"] == "shared"

        # Update to closed
        r = client.post(f"{API}/handoffs/{handoff_id}/status",
                        headers=a["headers"], json={"status": "closed"})
        assert r.status_code == 200

        # Unknown handoff_id -> 404
        r = client.post(f"{API}/handoffs/unknown_xyz/status",
                        headers=a["headers"], json={"status": "shared"})
        assert r.status_code == 404

        # Switch back to self taxpayer
        tps = client.get(f"{API}/taxpayers", headers=a["headers"]).json()
        self_tp = [t for t in tps if t["relationship"] == "self"][0]
        r = client.post(f"{API}/taxpayers/{self_tp['taxpayer_id']}/activate",
                        headers=a["headers"])
        assert r.status_code == 200

        # Self should still see original docs (still isolated)
        self_docs_after = client.get(f"{API}/documents", headers=a["headers"]).json()
        assert len(self_docs_after) == self_docs_count, \
            f"self isolation broken: had {self_docs_count} now {len(self_docs_after)}"

        # Self should have 0 handoffs (spouse's handoff isolated)
        self_hs = client.get(f"{API}/handoffs", headers=a["headers"]).json()
        assert len(self_hs["handoffs"]) == 0

        # Delete spouse
        r = client.delete(f"{API}/taxpayers/{spouse_id}", headers=a["headers"])
        assert r.status_code == 200

        # Delete self forbidden
        r = client.delete(f"{API}/taxpayers/{self_tp['taxpayer_id']}",
                          headers=a["headers"])
        assert r.status_code == 400

    def test_create_all_relationship_types(self, client):
        a = _signup(client)
        for rel in ("spouse", "dependent", "business", "other"):
            r = client.post(f"{API}/taxpayers", headers=a["headers"],
                            json={"name": f"TP-{rel}", "relationship": rel})
            assert r.status_code == 200, f"{rel}: {r.text}"
            assert r.json()["relationship"] == rel


# ---------- Regression: preserve existing features ----------
class TestRegression:
    def test_sources_still_returns_8(self, client, auth):
        r = client.get(f"{API}/sources", headers=auth["headers"])
        assert r.status_code == 200
        assert len(r.json()["sources"]) == 8

    def test_preferences_defaults(self, client):
        a = _signup(client)
        r = client.get(f"{API}/preferences", headers=a["headers"])
        assert r.status_code == 200
        assert r.json()["tax_year"] == 2025

    def test_chat_still_works(self, client, auth):
        r = client.post(f"{API}/chat", headers=auth["headers"],
                        json={"message": "hi", "tax_year": 2025})
        assert r.status_code == 200
        assert r.json().get("tax_year") == 2025

    def test_refund_estimator_still_works(self, client):
        a = _signup(client)
        # seed for docs so estimator has content
        client.post(f"{API}/demo/seed", headers=a["headers"])
        r = client.get(f"{API}/refund/estimate", headers=a["headers"])
        assert r.status_code == 200
