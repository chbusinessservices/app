"""TaxPilot AI new features: refund estimator, potential items, chat."""
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
def creds():
    return {
        "email": f"TEST_new_{uuid.uuid4().hex[:8]}@example.com",
        "password": "Secret123!",
        "name": "Test User"
    }


@pytest.fixture(scope="module")
def auth(client, creds):
    r = client.post(f"{API}/auth/signup", json=creds)
    assert r.status_code == 200, r.text
    body = r.json()
    token = body["session_token"]
    return {"headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


@pytest.fixture(scope="module")
def seeded_auth(client, creds):
    # A separate user that we WILL NOT seed, to test insufficient_data behaviour
    e = f"TEST_seed_{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/signup", json={"email": e, "password": "Secret123!", "name": "S"})
    assert r.status_code == 200
    token = r.json()["session_token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    # seed
    r2 = client.post(f"{API}/demo/seed", headers=headers)
    assert r2.status_code == 200
    return {"headers": headers}


# ---------------- Refund Estimator ----------------
class TestRefundEstimate:
    def test_empty_user_insufficient(self, client, auth):
        r = client.get(f"{API}/refund/estimate", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["status"] in {"insufficient_data", "blocked"}
        assert body["amount"] is None
        assert "disclaimer" in body and len(body["disclaimer"]) > 20
        assert isinstance(body["blockers"], list) and len(body["blockers"]) > 0

    def test_seeded_user_blocked(self, client, seeded_auth):
        # Seed created a Receipt with needs_review + open K-1 review
        r = client.get(f"{API}/refund/estimate", headers=seeded_auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "blocked"
        assert body["amount"] is None
        codes = [b["code"] for b in body["blockers"]]
        assert "OPEN_REVIEW_ITEMS" in codes
        assert "disclaimer" in body

    def test_disclaimer_always_present(self, client, auth):
        r = client.get(f"{API}/refund/estimate", headers=auth["headers"])
        assert "IRS" in r.json()["disclaimer"] or "professional" in r.json()["disclaimer"].lower()


# ---------------- Potential Items ----------------
class TestPotentialItems:
    def test_list_catalog(self, client, auth):
        r = client.get(f"{API}/potential-items", headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "disclaimer" in body
        assert len(body["items"]) == 5
        for it in body["items"]:
            assert "item_id" in it and "authority" in it and "risk_tier" in it
            assert "detected" in it

    def test_detection_flag_after_seed(self, client, seeded_auth):
        r = client.get(f"{API}/potential-items", headers=seeded_auth["headers"])
        items = {i["item_id"]: i for i in r.json()["items"]}
        # 1099-NEC + W-2 exist → home_office detected, retirement_savers detected
        assert items["home_office"]["detected"] is True
        assert items["retirement_savers"]["detected"] is True
        # medical_agi_floor requires Receipt (seeded includes Receipt classified)
        assert items["medical_agi_floor"]["detected"] is True

    def test_set_valid_disposition(self, client, seeded_auth):
        r = client.post(f"{API}/potential-items/home_office/disposition",
                        headers=seeded_auth["headers"], json={"disposition": "review"})
        assert r.status_code == 200
        assert r.json()["disposition"] == "review"
        # verify persisted
        got = client.get(f"{API}/potential-items", headers=seeded_auth["headers"]).json()
        home = next(i for i in got["items"] if i["item_id"] == "home_office")
        assert home["disposition"] == "review"

    def test_reject_unknown_disposition(self, client, seeded_auth):
        r = client.post(f"{API}/potential-items/home_office/disposition",
                        headers=seeded_auth["headers"], json={"disposition": "yolo"})
        assert r.status_code == 400

    def test_reject_unknown_item(self, client, auth):
        r = client.post(f"{API}/potential-items/nonexistent/disposition",
                        headers=auth["headers"], json={"disposition": "review"})
        assert r.status_code == 404

    def test_save_for_pro_review_creates_review_item(self, client, seeded_auth):
        before = client.get(f"{API}/review-queue", headers=seeded_auth["headers"]).json()
        r = client.post(f"{API}/potential-items/se_health_ins/disposition",
                        headers=seeded_auth["headers"], json={"disposition": "save_for_pro_review"})
        assert r.status_code == 200
        after = client.get(f"{API}/review-queue", headers=seeded_auth["headers"]).json()
        assert len(after) > len(before)
        assert any("se_health_ins" in i["title"] for i in after)

    def test_all_dispositions_accepted(self, client, seeded_auth):
        for d in ["review", "not_applicable", "need_help"]:
            r = client.post(f"{API}/potential-items/student_loan_int/disposition",
                            headers=seeded_auth["headers"], json={"disposition": d})
            assert r.status_code == 200, f"{d} failed: {r.text}"


# ---------------- Chat (grounded LLM) ----------------
class TestChat:
    def test_chat_returns_shape(self, client, auth):
        r = client.post(f"{API}/chat", headers=auth["headers"],
                        json={"message": "Can I deduct home office expenses if I'm self-employed?"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "answer" in body
        assert "citations" in body and isinstance(body["citations"], list)
        assert "requires_review" in body
        assert body["risk_tier"] in {"low", "medium", "high"}
        assert "missing_facts" in body
        assert "refusal" in body

    def test_chat_answer_non_empty(self, client, auth):
        r = client.post(f"{API}/chat", headers=auth["headers"],
                        json={"message": "What IRS publication covers business use of home?"})
        assert r.status_code == 200
        body = r.json()
        assert body["answer"] and len(body["answer"]) > 10
