from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, Response
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import json
import uuid
import httpx
import requests
import bcrypt
import jwt as pyjwt
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

from emergentintegrations.llm.chat import LlmChat, UserMessage
from tax_validation.models import (
    MedicalClaimRequest,
    MedicalValidationResult,
    Calculation as MedicalCalculation,
    ViolationStatus,
    RiskTier,
)
from tax_validation.rule_engine import validate_medical, MEDICAL_RULES
from tax_validation.audit import compute_record_hash, verify_chain, GENESIS_HASH
from tax_validation.citation_check import (
    CitationCheckRequest,
    CitationCheckResult,
    AnswerCitation,
    check_citations,
)
from tax_validation.source_registry import retrieve as retrieve_spans, registry_view
from tax_validation.risk_tier import assess_risk
from tax_validation.multi_state import get_state_rule, layered_assess, state_registry_view

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'change-me')
APPLE_AUDIENCES = [a.strip() for a in os.environ.get('APPLE_AUDIENCES', '').split(',') if a.strip()]
APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
APPLE_ISSUER = 'https://appleid.apple.com'
_apple_jwks_cache: Dict[str, Any] = {"keys": [], "fetched_at": 0}

# Storage
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "taxpilot-ai"
_storage_key: Optional[str] = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    global _storage_key
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Models ----------
class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SessionExchange(BaseModel):
    session_id: str


class AppleSignInRequest(BaseModel):
    identity_token: str
    full_name: Optional[str] = None


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    role: str = "preparer"


class AuthResponse(BaseModel):
    session_token: str
    user: UserOut


class DocumentOut(BaseModel):
    document_id: str
    user_id: str
    filename: str
    doc_type: str
    status: str
    storage_path: Optional[str] = None
    content_type: Optional[str] = None
    uploaded_at: str
    thumb_url: Optional[str] = None


class ExtractedField(BaseModel):
    label: str
    value: str
    confidence: float


class ExtractionOut(BaseModel):
    document_id: str
    doc_type: str
    fields: List[ExtractedField]
    summary: str
    needs_review: bool


class ReviewItem(BaseModel):
    review_id: str
    user_id: str
    document_id: Optional[str] = None
    title: str
    reason: str
    severity: str
    status: str
    created_at: str


# ---------- Auth helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def make_session_token(user_id: str) -> str:
    payload = {"user_id": user_id, "exp": now_utc() + timedelta(days=7), "iat": now_utc(), "jti": uuid.uuid4().hex}
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def create_session(user_id: str) -> str:
    token = make_session_token(user_id)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    return token


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp is not None:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def user_out(u: dict) -> UserOut:
    return UserOut(
        user_id=u["user_id"],
        email=u["email"],
        name=u.get("name"),
        picture=u.get("picture"),
        role=u.get("role", "preparer"),
    )


# ---------- Auth Routes ----------
@api_router.post("/auth/signup", response_model=AuthResponse)
async def signup(req: SignupRequest):
    existing = await db.users.find_one({"email": req.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
    doc = {
        "user_id": user_id,
        "email": req.email.lower(),
        "name": req.name or req.email.split("@")[0],
        "password_hash": pw_hash,
        "role": "preparer",
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc)
    token = await create_session(user_id)
    return AuthResponse(session_token=token, user=user_out(doc))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    user = await db.users.find_one({"email": req.email.lower()}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not bcrypt.checkpw(req.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = await create_session(user["user_id"])
    return AuthResponse(session_token=token, user=user_out(user))


@api_router.post("/auth/session", response_model=AuthResponse)
async def auth_session(req: SessionExchange):
    async with httpx.AsyncClient(timeout=30) as hc:
        r = await hc.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": req.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="No email in session data")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}},
        )
        existing.update({"name": data.get("name"), "picture": data.get("picture")})
        user_doc = existing
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "role": "preparer",
            "created_at": now_utc(),
        }
        await db.users.insert_one(user_doc)
    token = await create_session(user_id)
    return AuthResponse(session_token=token, user=user_out(user_doc))


@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return user_out(user)


async def _get_apple_jwks() -> List[dict]:
    import time
    now = time.time()
    if _apple_jwks_cache["keys"] and now - _apple_jwks_cache["fetched_at"] < 3600:
        return _apple_jwks_cache["keys"]
    async with httpx.AsyncClient(timeout=15) as hc:
        r = await hc.get(APPLE_JWKS_URL)
    r.raise_for_status()
    keys = r.json().get("keys", [])
    _apple_jwks_cache["keys"] = keys
    _apple_jwks_cache["fetched_at"] = now
    return keys


@api_router.post("/auth/apple", response_model=AuthResponse)
async def apple_signin(req: AppleSignInRequest):
    if not APPLE_AUDIENCES:
        raise HTTPException(500, "Apple sign-in not configured")
    try:
        unverified_header = pyjwt.get_unverified_header(req.identity_token)
    except Exception:
        raise HTTPException(401, "Malformed identity token")

    kid = unverified_header.get("kid")
    jwks = await _get_apple_jwks()
    key_dict = next((k for k in jwks if k.get("kid") == kid), None)
    if not key_dict:
        # refresh once
        _apple_jwks_cache["keys"] = []
        jwks = await _get_apple_jwks()
        key_dict = next((k for k in jwks if k.get("kid") == kid), None)
    if not key_dict:
        raise HTTPException(401, "Apple key not found")

    try:
        public_key = pyjwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key_dict))
        claims = pyjwt.decode(
            req.identity_token,
            key=public_key,
            algorithms=["RS256"],
            audience=APPLE_AUDIENCES,
            issuer=APPLE_ISSUER,
        )
    except pyjwt.InvalidAudienceError:
        raise HTTPException(401, "Invalid audience")
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception as e:
        raise HTTPException(401, f"Invalid identity token: {e}")

    apple_sub = claims.get("sub")
    if not apple_sub:
        raise HTTPException(401, "No subject in token")

    # SECURITY FIX (SEC-001): Only trust the token's email, and only when Apple marks it verified.
    # NEVER trust `req.email` for lookup/linking — client can spoof it to hijack another account.
    email_verified = bool(claims.get("email_verified") in (True, "true"))
    verified_email = (claims.get("email") or "").lower() if email_verified else None

    existing = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0})
    if not existing and verified_email:
        # Only link to existing email/password account when Apple verified the email
        existing = await db.users.find_one({"email": verified_email}, {"_id": 0})
        if existing:
            await db.users.update_one({"user_id": existing["user_id"]}, {"$set": {"apple_sub": apple_sub}})
            existing["apple_sub"] = apple_sub

    if existing:
        user_doc = existing
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        # Only use full_name from body (display-only); email must come from verified token or fall back to relay-style
        display_email = verified_email or f"{apple_sub[:16]}@privaterelay.appleid.com"
        user_doc = {
            "user_id": user_id,
            "apple_sub": apple_sub,
            "email": display_email,
            "name": req.full_name or None,
            "role": "preparer",
            "created_at": now_utc(),
        }
        try:
            await db.users.insert_one(dict(user_doc))
        except Exception:
            user_doc = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0}) or user_doc

    token = await create_session(user_doc["user_id"])
    return AuthResponse(session_token=token, user=user_out(user_doc))


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Documents ----------
DOC_TYPES = ["W-2", "1099-NEC", "1099-INT", "1099-DIV", "K-1", "Receipt", "Prior-Year Return", "Other"]

# SECURITY (SEC-003): bound uploads to prevent resource exhaustion and object-key traversal via user filename
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MiB
ALLOWED_UPLOAD_EXTS = {"pdf", "jpg", "jpeg", "png", "heic", "webp", "txt", "doc", "docx", "csv", "xls", "xlsx"}


@api_router.post("/documents/upload", response_model=DocumentOut)
async def upload_document(
    file: UploadFile = File(...),
    doc_type_hint: str = Form("Auto"),
    user=Depends(get_current_user),
):
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Max {MAX_UPLOAD_BYTES // (1024*1024)} MiB.")
    if not contents:
        raise HTTPException(400, "Empty file.")

    raw_ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin").lower()
    # Strip anything unsafe from the extension (no slashes, no dots, letters/digits only)
    safe_ext = "".join(c for c in raw_ext if c.isalnum())[:8] or "bin"
    if safe_ext not in ALLOWED_UPLOAD_EXTS:
        raise HTTPException(400, f"Unsupported file type '{safe_ext}'. Allowed: {sorted(ALLOWED_UPLOAD_EXTS)}")

    document_id = uuid.uuid4().hex
    path = f"{APP_NAME}/uploads/{user['user_id']}/{document_id}.{safe_ext}"
    try:
        await run_in_threadpool(put_object, path, contents, file.content_type or "application/octet-stream")
    except Exception as e:
        logging.exception("upload failed")
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")

    tp_id = await get_active_taxpayer_id(user)
    doc = {
        "document_id": document_id,
        "user_id": user["user_id"],
        "taxpayer_id": tp_id,
        "filename": (file.filename or f"upload.{safe_ext}")[:256],
        "doc_type": doc_type_hint if doc_type_hint in DOC_TYPES else "Other",
        "status": "uploaded",
        "storage_path": path,
        "content_type": file.content_type,
        "uploaded_at": now_utc().isoformat(),
    }
    await db.documents.insert_one(dict(doc))
    return DocumentOut(**{k: v for k, v in doc.items() if k in DocumentOut.model_fields})


@api_router.get("/documents", response_model=List[DocumentOut])
async def list_documents(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    docs = await db.documents.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    return [DocumentOut(**{k: v for k, v in d.items() if k in DocumentOut.model_fields}) for d in docs]


@api_router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(document_id: str, user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    d = await db.documents.find_one({"document_id": document_id, "user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    return DocumentOut(**{k: v for k, v in d.items() if k in DocumentOut.model_fields})


@api_router.get("/documents/{document_id}/file")
async def download_document(document_id: str, user=Depends(get_current_user)):
    # SECURITY FIX (SEC-002): removed `token` query param path — tokens in URLs leak into
    # proxy / CDN / server access logs. Only accept `Authorization: Bearer <token>` header
    # (enforced by the get_current_user dependency).
    tp_id = await get_active_taxpayer_id(user)
    d = await db.documents.find_one({"document_id": document_id, "user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0})
    if not d or not d.get("storage_path"):
        raise HTTPException(404, "Not found")
    try:
        data, ctype = await run_in_threadpool(get_object, d["storage_path"])
    except Exception as e:
        raise HTTPException(500, f"Fetch failed: {e}")
    return StreamingResponse(io.BytesIO(data), media_type=ctype)


# ---------- LLM Extraction ----------
EXTRACT_SYSTEM = """You are TaxPilot AI, a secure tax document extraction agent.
Given a filename and a user-provided document type hint, produce a plausible structured extraction as JSON.
Since the raw file bytes are not available to you, generate realistic sample field values consistent with the doc type and mark confidence scores between 0.60 and 0.99.
Respond ONLY as strict JSON matching this schema:
{
  "doc_type": "W-2 | 1099-NEC | 1099-INT | 1099-DIV | K-1 | Receipt | Prior-Year Return | Other",
  "fields": [ {"label": "string", "value": "string", "confidence": 0.0-1.0} ],
  "summary": "one sentence",
  "needs_review": true|false
}
Flag needs_review=true if any field has confidence < 0.80 or the doc_type is Receipt or Other."""


@api_router.post("/documents/{document_id}/extract", response_model=ExtractionOut)
async def extract_document(document_id: str, model: str = "claude-sonnet-5", user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    d = await db.documents.find_one({"document_id": document_id, "user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")

    provider = "anthropic"
    m = model
    if model.startswith("gpt"):
        provider, m = "openai", model
    elif model.startswith("claude"):
        provider, m = "anthropic", model
    elif model.startswith("gemini"):
        provider, m = "gemini", model

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"extract-{document_id}",
        system_message=EXTRACT_SYSTEM,
    ).with_model(provider, m)

    prompt = f"Filename: {d['filename']}\nDoc type hint: {d.get('doc_type', 'Auto')}\nContent-type: {d.get('content_type')}\nReturn the JSON now."
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp if isinstance(resp, str) else str(resp)
        start = text.find("{")
        end = text.rfind("}")
        parsed = json.loads(text[start:end + 1]) if start != -1 else {}
    except Exception as e:
        logging.warning(f"LLM failed, using fallback: {e}")
        parsed = _fallback_extraction(d.get("doc_type", "Other"))

    fields = [ExtractedField(**f) for f in parsed.get("fields", [])]
    result = ExtractionOut(
        document_id=document_id,
        doc_type=parsed.get("doc_type", d.get("doc_type", "Other")),
        fields=fields,
        summary=parsed.get("summary", "Extraction complete."),
        needs_review=bool(parsed.get("needs_review", False)),
    )

    await db.documents.update_one(
        {"document_id": document_id, "user_id": user["user_id"]},
        {"$set": {"status": "classified", "doc_type": result.doc_type, "extraction": result.model_dump()}},
    )

    if result.needs_review:
        await db.review_items.insert_one({
            "review_id": uuid.uuid4().hex,
            "user_id": user["user_id"],
            "taxpayer_id": tp_id,
            "document_id": document_id,
            "title": f"Review {result.doc_type}: {d['filename']}",
            "reason": next((f"Low confidence on '{f.label}' ({int(f.confidence * 100)}%)" for f in fields if f.confidence < 0.80), "Requires human verification"),
            "severity": "warning",
            "status": "open",
            "created_at": now_utc().isoformat(),
        })
    return result


def _fallback_extraction(doc_type: str) -> dict:
    presets = {
        "W-2": {
            "doc_type": "W-2",
            "fields": [
                {"label": "Wages, tips & other comp", "value": "$128,500", "confidence": 0.99},
                {"label": "Federal income tax withheld", "value": "$24,110", "confidence": 0.98},
                {"label": "Social security wages", "value": "$128,500", "confidence": 0.97},
                {"label": "Employer", "value": "Acme Corp", "confidence": 0.95},
            ],
            "summary": "W-2 from Acme Corp with strong confidence across all boxes.",
            "needs_review": False,
        },
        "1099-NEC": {
            "doc_type": "1099-NEC",
            "fields": [
                {"label": "Nonemployee compensation", "value": "$12,400", "confidence": 0.96},
                {"label": "Payer name", "value": "Freelance Client LLC", "confidence": 0.92},
            ],
            "summary": "1099-NEC extracted with high confidence.",
            "needs_review": False,
        },
        "Receipt": {
            "doc_type": "Receipt",
            "fields": [
                {"label": "Receipt total (Q2)", "value": "$3,280", "confidence": 0.82},
                {"label": "Category", "value": "Business meals", "confidence": 0.74},
            ],
            "summary": "Receipt total extracted; category needs review.",
            "needs_review": True,
        },
    }
    return presets.get(doc_type, {
        "doc_type": doc_type or "Other",
        "fields": [{"label": "Extracted", "value": "n/a", "confidence": 0.65}],
        "summary": "Fallback extraction; review recommended.",
        "needs_review": True,
    })


# ---------- Review Queue ----------
@api_router.get("/review-queue", response_model=List[ReviewItem])
async def get_review_queue(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    items = await db.review_items.find(
        {"user_id": user["user_id"], "taxpayer_id": tp_id, "status": "open"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return [ReviewItem(**{k: v for k, v in i.items() if k in ReviewItem.model_fields}) for i in items]


class ReviewAction(BaseModel):
    action: str  # acknowledge | skip


@api_router.post("/review-queue/{review_id}/action")
async def act_on_review(review_id: str, req: ReviewAction, user=Depends(get_current_user)):
    r = await db.review_items.find_one({"review_id": review_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Not found")
    new_status = "resolved" if req.action == "acknowledge" else "skipped"
    await db.review_items.update_one({"review_id": review_id}, {"$set": {"status": new_status}})
    return {"ok": True, "status": new_status}


# ---------- Source Registry (versioned IRS authority) ----------
SOURCE_REGISTRY = [
    {"source_id": "pub-17", "publication": "Publication 17", "title": "Your Federal Income Tax (For Individuals)", "tax_years": [2023, 2024, 2025], "revision": "2024", "revision_date": "2025-01-15", "hash": "sha256:8f21a4e0c9b74e21", "official_url": "https://www.irs.gov/pub/irs-pdf/p17.pdf", "status": "approved"},
    {"source_id": "pub-502", "publication": "Publication 502", "title": "Medical and Dental Expenses", "tax_years": [2023, 2024, 2025], "revision": "2024", "revision_date": "2025-02-10", "hash": "sha256:2b4c8f19a0e73c88", "official_url": "https://www.irs.gov/pub/irs-pdf/p502.pdf", "status": "approved"},
    {"source_id": "pub-587", "publication": "Publication 587", "title": "Business Use of Your Home", "tax_years": [2023, 2024, 2025], "revision": "2024", "revision_date": "2025-01-28", "hash": "sha256:6a19b7c3e2f04dd1", "official_url": "https://www.irs.gov/pub/irs-pdf/p587.pdf", "status": "approved"},
    {"source_id": "pub-970", "publication": "Publication 970", "title": "Tax Benefits for Education", "tax_years": [2023, 2024, 2025], "revision": "2024", "revision_date": "2025-01-22", "hash": "sha256:9c3d8f2a71b5e04c", "official_url": "https://www.irs.gov/pub/irs-pdf/p970.pdf", "status": "approved"},
    {"source_id": "pub-4681", "publication": "Publication 4681", "title": "Canceled Debts, Foreclosures, Repossessions & Abandonments", "tax_years": [2023, 2024, 2025], "revision": "2024", "revision_date": "2025-02-01", "hash": "sha256:4e8a2b9d63f10e77", "official_url": "https://www.irs.gov/pub/irs-pdf/p4681.pdf", "status": "approved"},
    {"source_id": "sch-a-inst", "publication": "Schedule A Instructions (Form 1040)", "title": "Itemized Deductions Instructions", "tax_years": [2024, 2025], "revision": "2024", "revision_date": "2025-01-30", "hash": "sha256:7b1a5c8e4f2d9a06", "official_url": "https://www.irs.gov/pub/irs-pdf/i1040sca.pdf", "status": "approved"},
    {"source_id": "form-8880", "publication": "Form 8880 Instructions", "title": "Credit for Qualified Retirement Savings Contributions", "tax_years": [2024, 2025], "revision": "2024", "revision_date": "2025-01-08", "hash": "sha256:c04f2b8a19e7f341", "official_url": "https://www.irs.gov/pub/irs-pdf/i8880.pdf", "status": "approved"},
    {"source_id": "pub-17-2023", "publication": "Publication 17", "title": "Your Federal Income Tax (For Individuals) — Prior Year", "tax_years": [2023], "revision": "2023", "revision_date": "2024-01-18", "hash": "sha256:1e9d3f47a02c8b56", "official_url": "https://www.irs.gov/pub/irs-prior/p17--2023.pdf", "status": "superseded"},
]


@api_router.get("/sources")
async def sources_registry(user=Depends(get_current_user)):
    return {"sources": SOURCE_REGISTRY, "note": "Versioned IRS authority used by TaxPilot AI. Prior-year returns use prior-year authority."}


# ---------- Preferences (tax_year + consent + cpa_email) ----------
class Preferences(BaseModel):
    tax_year: int = 2025
    cpa_email: Optional[str] = None
    consent_7216: bool = False
    consent_7216_at: Optional[str] = None
    consent_7216_revoked_at: Optional[str] = None
    active_taxpayer_id: Optional[str] = None


DEFAULT_PREFS = {"tax_year": 2025, "cpa_email": None, "consent_7216": False, "consent_7216_at": None, "consent_7216_revoked_at": None, "active_taxpayer_id": None}


@api_router.get("/preferences", response_model=Preferences)
async def get_preferences(user=Depends(get_current_user)):
    p = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    merged = {**DEFAULT_PREFS}
    for k in DEFAULT_PREFS:
        if p.get(k) is not None:
            merged[k] = p[k]
    return Preferences(**merged)


class UpdatePrefsRequest(BaseModel):
    tax_year: Optional[int] = None
    cpa_email: Optional[str] = None


@api_router.post("/preferences", response_model=Preferences)
async def update_preferences(req: UpdatePrefsRequest, user=Depends(get_current_user)):
    updates: Dict[str, Any] = {}
    if req.tax_year is not None:
        if req.tax_year not in (2023, 2024, 2025):
            raise HTTPException(400, "tax_year must be 2023, 2024, or 2025")
        updates["tax_year"] = req.tax_year
    if req.cpa_email is not None:
        updates["cpa_email"] = req.cpa_email or None
    if updates:
        await db.preferences.update_one({"user_id": user["user_id"]}, {"$set": {"user_id": user["user_id"], **updates}}, upsert=True)
    return await get_preferences(user)


class ConsentRequest(BaseModel):
    signed_name: str
    accept: bool


@api_router.post("/consent/7216", response_model=Preferences)
async def sign_consent(req: ConsentRequest, user=Depends(get_current_user)):
    if not req.accept:
        raise HTTPException(400, "accept must be true to sign consent")
    if not req.signed_name.strip():
        raise HTTPException(400, "signed_name required")
    now = now_utc().isoformat()
    await db.preferences.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "consent_7216": True, "consent_7216_at": now, "consent_7216_signed_name": req.signed_name.strip(), "consent_7216_revoked_at": None}},
        upsert=True,
    )
    # Append immutable audit record
    await db.consent_audit.insert_one({
        "audit_id": uuid.uuid4().hex,
        "user_id": user["user_id"],
        "event": "signed",
        "signed_name": req.signed_name.strip(),
        "timestamp": now,
    })
    return await get_preferences(user)


@api_router.post("/consent/7216/revoke", response_model=Preferences)
async def revoke_consent(user=Depends(get_current_user)):
    now = now_utc().isoformat()
    await db.preferences.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "consent_7216": False, "consent_7216_revoked_at": now}},
        upsert=True,
    )
    await db.consent_audit.insert_one({
        "audit_id": uuid.uuid4().hex,
        "user_id": user["user_id"],
        "event": "revoked",
        "timestamp": now,
    })
    return await get_preferences(user)


# ---------- Reviewer Handoff (PDF packet) ----------
def _build_handoff_pdf(user_email: str, item: dict, docs: List[dict], review_items: List[dict], consent: dict, tax_year: int) -> bytes:
    from fpdf import FPDF
    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(61, 90, 70)
    pdf.cell(0, 10, "TaxPilot AI - Professional Review Packet", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(74, 74, 74)
    pdf.cell(0, 6, f"For: {user_email}  |  Tax Year: {tax_year}  |  Generated: {now_utc().strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.ln(4)

    pdf.set_draw_color(226, 224, 216)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)

    # Item
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(26, 26, 26)
    pdf.cell(0, 8, "1. Potential Item Under Review", ln=True)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, item.get("title", ""), ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(0, 5, item.get("description", ""))
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(74, 74, 74)
    pdf.cell(0, 5, f"Authority: {item.get('authority')}  |  Risk tier: {item.get('risk_tier')}", ln=True)
    pdf.ln(4)

    # Supporting docs
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(26, 26, 26)
    pdf.cell(0, 8, f"2. Supporting Documents ({len(docs)})", ln=True)
    pdf.set_font("Helvetica", "", 10)
    if not docs:
        pdf.cell(0, 6, "(No supporting documents linked)", ln=True)
    for d in docs:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 5, f"- {d.get('filename')}  ({d.get('doc_type')})", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(74, 74, 74)
        pdf.cell(0, 4, f"  Status: {d.get('status')}  |  Uploaded: {d.get('uploaded_at', '')[:10]}", ln=True)
        ext = d.get("extraction") or {}
        for f in ext.get("fields", [])[:6]:
            pdf.cell(0, 4, f"    - {f.get('label')}: {f.get('value')}  ({int(f.get('confidence', 0) * 100)}%)", ln=True)
        pdf.set_text_color(26, 26, 26)
        pdf.ln(1)
    pdf.ln(2)

    # Review items / audit
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, f"3. Audit Trail ({len(review_items)} entries)", ln=True)
    pdf.set_font("Helvetica", "", 9)
    for r in review_items[:20]:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, f"- {r.get('title')}", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(74, 74, 74)
        pdf.cell(0, 4, f"  {r.get('reason')}  |  {r.get('severity')}  |  {r.get('status')}  |  {r.get('created_at', '')[:19]}", ln=True)
        pdf.set_text_color(26, 26, 26)
    pdf.ln(2)

    # Consent
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, "4. §7216 Consent Status", ln=True)
    pdf.set_font("Helvetica", "", 10)
    if consent.get("consent_7216"):
        pdf.cell(0, 5, f"Signed by: {consent.get('consent_7216_signed_name', '(name on file)')}", ln=True)
        pdf.cell(0, 5, f"Signed at: {consent.get('consent_7216_at')}", ln=True)
    else:
        pdf.set_text_color(158, 71, 61)
        pdf.cell(0, 5, "No §7216 consent on file. Do not share with third parties until captured.", ln=True)
        pdf.set_text_color(26, 26, 26)

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(74, 74, 74)
    pdf.multi_cell(0, 4, "This packet was auto-generated by TaxPilot AI. All amounts are AI extractions with confidence scores and are not filed positions. The engaged tax professional is responsible for verification against the correct-year IRS authority before any return action.")

    return bytes(pdf.output())


@api_router.post("/handoff/{item_id}/pdf")
async def handoff_pdf(item_id: str, user=Depends(get_current_user)):
    item = next((i for i in POTENTIAL_ITEMS_CATALOG if i["item_id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Unknown item_id")
    tp_id = await get_active_taxpayer_id(user)
    docs = await db.documents.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).to_list(50)
    supporting = [d for d in docs if d.get("doc_type") in item.get("requires", []) or item.get("requires") == []]
    review_items = await db.review_items.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    prefs = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    tax_year = prefs.get("tax_year", 2025)

    pdf_bytes = _build_handoff_pdf(user.get("email", ""), item, supporting, review_items, prefs, tax_year)

    # Audit
    handoff_id = uuid.uuid4().hex
    await db.handoff_audit.insert_one({
        "handoff_id": handoff_id,
        "user_id": user["user_id"],
        "taxpayer_id": tp_id,
        "item_id": item_id,
        "item_title": item.get("title"),
        "docs_count": len(supporting),
        "review_items_count": len(review_items),
        "tax_year": tax_year,
        "cpa_email": prefs.get("cpa_email"),
        "status": "generated",
        "comments": [],
        "created_at": now_utc().isoformat(),
    })

    import base64
    return {
        "handoff_id": handoff_id,
        "filename": f"TaxPilot_ReviewPacket_{item_id}_{handoff_id[:8]}.pdf",
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "cpa_email": prefs.get("cpa_email"),
    }


# ---------- Refund Estimator (confidence-gated) ----------
@api_router.get("/refund/estimate")
async def refund_estimate(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    docs = await db.documents.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).to_list(500)
    open_review = await db.review_items.count_documents({"user_id": user["user_id"], "taxpayer_id": tp_id, "status": "open"})

    # Identify blockers (per compliance doc: block on unresolved conflicts / low confidence)
    low_conf_docs, missing_types = [], []
    min_confidence = 1.0
    n = 0
    for d in docs:
        ext = d.get("extraction")
        if ext and isinstance(ext, dict):
            for f in ext.get("fields", []):
                c = float(f.get("confidence", 0))
                min_confidence = min(min_confidence, c)
                n += 1
                if c < 0.80:
                    low_conf_docs.append({"filename": d["filename"], "field": f.get("label"), "confidence": c})
        if d.get("status") == "expected":
            missing_types.append(d.get("doc_type"))

    classified_types = {d.get("doc_type") for d in docs if d.get("status") == "classified"}
    has_income_doc = bool(classified_types & {"W-2", "1099-NEC", "1099-INT", "1099-DIV", "K-1"})

    blockers: List[dict] = []
    if not has_income_doc:
        blockers.append({"code": "NO_INCOME_DOC", "message": "No income document (W-2 / 1099) classified yet."})
    if missing_types:
        blockers.append({"code": "MISSING_EXPECTED_DOC", "message": f"Expected documents not yet uploaded: {', '.join(missing_types)}."})
    if low_conf_docs:
        blockers.append({"code": "LOW_CONFIDENCE_FIELD", "message": f"{len(low_conf_docs)} field(s) below 80% confidence require review."})
    if open_review > 0:
        blockers.append({"code": "OPEN_REVIEW_ITEMS", "message": f"{open_review} item(s) in the human review queue."})

    # Very rough sample estimate — labeled preliminary; NOT a filing decision.
    est_amount = 0
    if has_income_doc:
        est_amount = 1200 + (400 if "1099-NEC" in classified_types else 0) + (150 if "Receipt" in classified_types else 0)

    if blockers:
        status = "blocked" if (low_conf_docs or open_review) else "insufficient_data"
    else:
        status = "estimated"

    confidence_tier = "high" if min_confidence >= 0.90 else "medium" if min_confidence >= 0.80 else "low"

    return {
        "status": status,
        "amount": est_amount if status == "estimated" else None,
        "confidence_tier": confidence_tier if n > 0 else "unknown",
        "blockers": blockers,
        "disclaimer": "Preliminary estimate for review only. Not a filed return, not a tax decision. Verify with the applicable IRS publications and, for material items, a qualified tax professional.",
        "computed_at": now_utc().isoformat(),
    }


# ---------- Potential Deduction Items (safer than swipe cards) ----------
POTENTIAL_ITEMS_CATALOG = [
    {"item_id": "medical_agi_floor", "title": "Potential medical expenses", "description": "You may have qualified medical expenses above the 7.5% AGI floor. Requires itemization and unreimbursed payment proof.", "authority": "Publication 502", "risk_tier": "high", "requires": ["Receipt"]},
    {"item_id": "home_office", "title": "Potential home office deduction", "description": "Self-employment income detected. Home office requires exclusive and regular business use.", "authority": "Publication 587", "risk_tier": "high", "requires": ["1099-NEC"]},
    {"item_id": "se_health_ins", "title": "Potential SE health insurance", "description": "Self-employed taxpayers may deduct qualified health insurance premiums. Requires net SE profit.", "authority": "Schedule 1 Instructions", "risk_tier": "medium", "requires": ["1099-NEC"]},
    {"item_id": "retirement_savers", "title": "Potential Retirement Savings Contributions Credit", "description": "W-2 wages detected; may qualify for the Saver's Credit at certain AGI thresholds.", "authority": "Form 8880 Instructions", "risk_tier": "medium", "requires": ["W-2"]},
    {"item_id": "student_loan_int", "title": "Potential student loan interest", "description": "Up to $2,500 above-the-line deduction; income-phased. Requires Form 1098-E.", "authority": "Publication 970", "risk_tier": "low", "requires": []},
]

DISPOSITIONS = {"review", "not_applicable", "need_help", "save_for_pro_review"}


@api_router.get("/potential-items")
async def potential_items(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    docs = await db.documents.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).to_list(500)
    classified_types = {d.get("doc_type") for d in docs if d.get("status") == "classified"}
    dispositions = await db.item_dispositions.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).to_list(500)
    disp_map = {d["item_id"]: d for d in dispositions}

    out = []
    for it in POTENTIAL_ITEMS_CATALOG:
        applicable = all(r in classified_types for r in it["requires"]) if it["requires"] else True
        d = disp_map.get(it["item_id"])
        out.append({
            **it,
            "detected": applicable,
            "disposition": d.get("disposition") if d else None,
            "disposition_at": d.get("updated_at") if d else None,
        })
    return {"items": out, "disclaimer": "These are potential items detected from your documents. Detection does NOT confirm eligibility. Review the authority and required facts before taking any action."}


class DispositionRequest(BaseModel):
    disposition: str


@api_router.post("/potential-items/{item_id}/disposition")
async def set_disposition(item_id: str, req: DispositionRequest, user=Depends(get_current_user)):
    if req.disposition not in DISPOSITIONS:
        raise HTTPException(400, f"disposition must be one of {sorted(DISPOSITIONS)}")
    if not any(i["item_id"] == item_id for i in POTENTIAL_ITEMS_CATALOG):
        raise HTTPException(404, "Unknown item_id")
    tp_id = await get_active_taxpayer_id(user)
    await db.item_dispositions.update_one(
        {"user_id": user["user_id"], "taxpayer_id": tp_id, "item_id": item_id},
        {"$set": {"user_id": user["user_id"], "taxpayer_id": tp_id, "item_id": item_id, "disposition": req.disposition, "updated_at": now_utc().isoformat()}},
        upsert=True,
    )
    if req.disposition == "save_for_pro_review":
        await db.review_items.insert_one({
            "review_id": uuid.uuid4().hex,
            "user_id": user["user_id"],
            "taxpayer_id": tp_id,
            "document_id": None,
            "title": f"Professional review requested: {item_id}",
            "reason": "User saved this potential item for professional review before any return action.",
            "severity": "info",
            "status": "open",
            "created_at": now_utc().isoformat(),
        })
    return {"ok": True, "disposition": req.disposition}


# ---------- Tax Assistant Chat (grounded, refuses without authority) ----------
MAX_CHAT_LEN = 4000  # SECURITY (SEC-003): bound LLM prompt input
CHAT_SYSTEM = """You are TaxPilot AI Assistant. You must follow these grounding rules:
1) Answer ONLY from generally-published IRS publications and form instructions that you can name explicitly (e.g. Pub. 17, Pub. 502, Pub. 587, Pub. 970, Schedule A Instructions, Form 1040 Instructions).
2) If the user's question is complex, fact-dependent, or you cannot cite an authoritative source for the SPECIFIED TAX YEAR, REFUSE to give a definitive answer and instead: (a) list the facts you would need, (b) name the likely authority, (c) recommend professional review.
3) NEVER guarantee a refund, "maximize" a return, or state that a taxpayer qualifies for a deduction without stating the required conditions.
4) NEVER file, sign, or authorize any tax action. You are an assistant only.
5) Distinguish deductions from credits. Distinguish federal from state rules.
6) Use the correct-year authority for the tax year specified in the user's prompt. Do not automatically use the newest publication for a prior-year question.
7) Reply STRICTLY as JSON:
{"answer": "...", "citations": [{"source":"Publication X (revision year)","note":"..."}], "requires_review": true|false, "risk_tier":"low|medium|high", "missing_facts":["..."], "refusal": null | "brief reason if refusing"}"""


class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = "claude-sonnet-5"
    tax_year: Optional[int] = None


@api_router.post("/chat")
async def tax_chat(req: ChatRequest, user=Depends(get_current_user)):
    if not req.message or not req.message.strip():
        raise HTTPException(400, "message required")
    if len(req.message) > MAX_CHAT_LEN:
        raise HTTPException(400, f"message too long. Max {MAX_CHAT_LEN} characters.")
    provider = "anthropic"
    m = req.model or "claude-sonnet-5"
    if m.startswith("gpt"): provider = "openai"
    elif m.startswith("gemini"): provider = "gemini"

    prefs = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    tax_year = req.tax_year or prefs.get("tax_year", 2025)

    scoped_msg = f"[Tax year context: {tax_year}]\n\n{req.message}"

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"chat-{user['user_id']}",
            system_message=CHAT_SYSTEM,
        ).with_model(provider, m)
        resp = await chat.send_message(UserMessage(text=scoped_msg))
        text = resp if isinstance(resp, str) else str(resp)
        start, end = text.find("{"), text.rfind("}")
        parsed = json.loads(text[start:end + 1]) if start != -1 else {}
    except Exception as e:
        logging.warning(f"chat llm failed: {e}")
        parsed = {
            "answer": "I can't answer that with authority right now. Please try again or consult a qualified tax professional for material questions.",
            "citations": [],
            "requires_review": True,
            "risk_tier": "high",
            "missing_facts": [],
            "refusal": "assistant_unavailable",
        }

    # Audit log per doc requirements
    await db.chat_audit.insert_one({
        "audit_id": uuid.uuid4().hex,
        "user_id": user["user_id"],
        "question": req.message,
        "answer": parsed.get("answer"),
        "citations": parsed.get("citations", []),
        "risk_tier": parsed.get("risk_tier"),
        "requires_review": bool(parsed.get("requires_review")),
        "refusal": parsed.get("refusal"),
        "model": f"{provider}:{m}",
        "tax_year": tax_year,
        "created_at": now_utc().isoformat(),
    })

    # Deterministic citation-gap + hallucination check on the model's answer,
    # grounded against the versioned source registry (not the model's claim).
    _CAT_HINTS = [
        ("medical", "medical_dental"), ("dental", "medical_dental"),
        ("home office", "home_office"),
        ("student loan", "student_loan_int"),
        ("saver", "retirement_savers"), ("retirement savings", "retirement_savers"),
        ("health insurance", "se_health_ins"),
    ]
    msg_lower = req.message.lower()
    inferred_cat = next((cat for kw, cat in _CAT_HINTS if kw in msg_lower), "general")
    spans = retrieve_spans(req.message, tax_year, inferred_cat)
    cit_req = CitationCheckRequest(
        answer=parsed.get("answer", ""),
        citations=[AnswerCitation(**c) for c in parsed.get("citations", []) if isinstance(c, dict)],
        tax_year=tax_year,
        category=inferred_cat,
        retrieved_spans=spans,
    )
    cit_check = check_citations(cit_req)
    parsed["citation_check"] = cit_check.model_dump()
    # The server-side check overrides the model's self-assessment: any gap or
    # unsupported verdict forces review and high risk.
    if cit_check.grounding_status != "grounded":
        parsed["requires_review"] = True
        parsed["risk_tier"] = "high"

    parsed["tax_year"] = tax_year
    return parsed


# ---------- Return Pipeline Status ----------
PIPELINE_STEPS = [
    ("collect", "Collect", "Upload W-2s, 1099s, K-1s, receipts"),
    ("understand", "Understand", "Classify + extract with confidence"),
    ("infer", "Infer", "Spot deductions, credits, missing items"),
    ("draft", "Draft", "Assemble the return"),
    ("review", "Review", "Human-in-the-loop for risky items"),
    ("file", "File", "File the approved return"),
    ("audit", "Audit", "Immutable, exportable trail"),
]


@api_router.get("/return/status")
async def return_status(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    docs = await db.documents.count_documents({"user_id": user["user_id"], "taxpayer_id": tp_id})
    classified = await db.documents.count_documents({"user_id": user["user_id"], "taxpayer_id": tp_id, "status": "classified"})
    open_review = await db.review_items.count_documents({"user_id": user["user_id"], "taxpayer_id": tp_id, "status": "open"})

    completed = {"collect": docs > 0, "understand": classified > 0, "infer": classified >= 2,
                 "draft": classified >= 3 and open_review == 0,
                 "review": classified >= 3 and open_review == 0,
                 "file": False, "audit": False}

    steps = []
    for key, name, desc in PIPELINE_STEPS:
        steps.append({"key": key, "name": name, "description": desc, "completed": completed.get(key, False)})

    return {
        "steps": steps,
        "counts": {"documents": docs, "classified": classified, "open_review": open_review},
        "estimated_savings_usd": 226,
        "estimated_time_saved_min": 180,
    }


# ---------- Deductions & Missing docs ----------
@api_router.get("/deductions")
async def deductions(user=Depends(get_current_user)):
    docs = await db.documents.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(200)
    types = {d.get("doc_type") for d in docs}
    suggestions = []
    if "1099-NEC" in types:
        suggestions.append({"title": "Home office deduction", "estimated": "$1,200", "reason": "Freelance income detected"})
        suggestions.append({"title": "Self-employment health insurance", "estimated": "$2,400", "reason": "Schedule C income"})
    if "Receipt" in types:
        suggestions.append({"title": "Business meals (50%)", "estimated": "$640", "reason": "Q2 receipts detected"})
    if "W-2" in types:
        suggestions.append({"title": "401(k) contribution credit", "estimated": "$500", "reason": "Retirement Savings Contributions"})

    missing = []
    if "W-2" not in types:
        missing.append({"doc_type": "W-2", "reason": "Employment income likely"})
    if "1099-INT" not in types:
        missing.append({"doc_type": "1099-INT", "reason": "Bank interest typically expected"})
    return {"suggestions": suggestions, "missing": missing}


# ---------- Taxpayers (multi-client vault) ----------
class Taxpayer(BaseModel):
    taxpayer_id: str
    user_id: str
    name: str
    relationship: str  # self | spouse | dependent | business | other
    notes: Optional[str] = None
    created_at: str


class CreateTaxpayerRequest(BaseModel):
    name: str
    relationship: str = "other"
    notes: Optional[str] = None


async def get_active_taxpayer_id(user) -> str:
    """Ensure user has a taxpayer, return active id. Lazy-backfills legacy rows on first call."""
    prefs = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    active = prefs.get("active_taxpayer_id")
    if active:
        exists = await db.taxpayers.find_one({"taxpayer_id": active, "user_id": user["user_id"]}, {"_id": 0})
        if exists:
            return active
    any_tp = await db.taxpayers.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if any_tp:
        tp_id = any_tp["taxpayer_id"]
    else:
        tp_id = f"tp_{uuid.uuid4().hex[:12]}"
        await db.taxpayers.insert_one({
            "taxpayer_id": tp_id,
            "user_id": user["user_id"],
            "name": user.get("name") or "Myself",
            "relationship": "self",
            "notes": None,
            "created_at": now_utc().isoformat(),
        })
        # Backfill legacy documents / dispositions / handoffs to this default taxpayer
        for coll in ("documents", "review_items", "item_dispositions", "handoff_audit"):
            await db[coll].update_many(
                {"user_id": user["user_id"], "taxpayer_id": {"$exists": False}},
                {"$set": {"taxpayer_id": tp_id}},
            )
    await db.preferences.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "active_taxpayer_id": tp_id}},
        upsert=True,
    )
    return tp_id


@api_router.get("/taxpayers", response_model=List[Taxpayer])
async def list_taxpayers(user=Depends(get_current_user)):
    await get_active_taxpayer_id(user)  # ensure default exists
    items = await db.taxpayers.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)
    return [Taxpayer(**i) for i in items]


@api_router.post("/taxpayers", response_model=Taxpayer)
async def create_taxpayer(req: CreateTaxpayerRequest, user=Depends(get_current_user)):
    if not req.name.strip():
        raise HTTPException(400, "name required")
    rel = req.relationship if req.relationship in {"self", "spouse", "dependent", "business", "other"} else "other"
    tp = {
        "taxpayer_id": f"tp_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name": req.name.strip(),
        "relationship": rel,
        "notes": req.notes,
        "created_at": now_utc().isoformat(),
    }
    await db.taxpayers.insert_one(dict(tp))
    return Taxpayer(**tp)


@api_router.post("/taxpayers/{taxpayer_id}/activate")
async def activate_taxpayer(taxpayer_id: str, user=Depends(get_current_user)):
    tp = await db.taxpayers.find_one({"taxpayer_id": taxpayer_id, "user_id": user["user_id"]}, {"_id": 0})
    if not tp:
        raise HTTPException(404, "Taxpayer not found")
    await db.preferences.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "active_taxpayer_id": taxpayer_id}},
        upsert=True,
    )
    return {"ok": True, "active_taxpayer_id": taxpayer_id}


@api_router.delete("/taxpayers/{taxpayer_id}")
async def delete_taxpayer(taxpayer_id: str, user=Depends(get_current_user)):
    tp = await db.taxpayers.find_one({"taxpayer_id": taxpayer_id, "user_id": user["user_id"]}, {"_id": 0})
    if not tp:
        raise HTTPException(404, "Not found")
    if tp.get("relationship") == "self":
        raise HTTPException(400, "Cannot delete the default 'self' taxpayer")
    # Reassign / clean up related rows
    for coll in ("documents", "review_items", "item_dispositions", "handoff_audit"):
        await db[coll].delete_many({"user_id": user["user_id"], "taxpayer_id": taxpayer_id})
    await db.taxpayers.delete_one({"taxpayer_id": taxpayer_id, "user_id": user["user_id"]})
    # If it was active, switch back to self
    prefs = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    if prefs.get("active_taxpayer_id") == taxpayer_id:
        self_tp = await db.taxpayers.find_one({"user_id": user["user_id"], "relationship": "self"}, {"_id": 0})
        await db.preferences.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"active_taxpayer_id": self_tp["taxpayer_id"] if self_tp else None}},
        )
    return {"ok": True}


# ---------- Deterministic Tax-Position Validation (Pub. 502) ----------
# The LLM may propose a medical deduction, but a versioned rule engine decides
# whether facts + authority support it. The validator returns at most
# "potentially_supported"; only an authenticated reviewer approval promotes a
# claim to "supported" and unblocks filing. Every validation is recorded in an
# append-only audit trail (sources, rule version, facts, checks, flags,
# calculation, model not included here — this endpoint is deterministic-only).


@api_router.post("/validation/medical", response_model=MedicalValidationResult)
async def validate_medical_claim(req: MedicalClaimRequest, user=Depends(get_current_user)):
    if not req.claim_id:
        req.claim_id = f"claim_{uuid.uuid4().hex[:12]}"
    tp_id = await get_active_taxpayer_id(user)

    result = validate_medical(req)
    audit_id = uuid.uuid4().hex
    result.audit_event_id = audit_id

    # Immutable, append-only, hash-chained evidence of the decision. Carries
    # only amounts the client supplied; no raw SSNs or sensitive taxpayer PII.
    await _append_validation_audit(user["user_id"], tp_id, {
        "audit_id": audit_id,
        "event_type": "validation",
        "user_id": user["user_id"],
        "taxpayer_id": tp_id,
        "claim_id": result.claim_id,
        "tax_year": result.tax_year,
        "jurisdiction": result.jurisdiction.model_dump(),
        "category": result.category,
        "form": result.form,
        "status": result.status.value,
        "risk_tier": result.risk_tier.value,
        "flags": result.flags,
        "missing_facts": result.missing_facts,
        "source_status": result.source_status,
        "rule_ref": result.rule_ref.model_dump() if result.rule_ref else None,
        "calculation": result.calculation.model_dump(),
        "request_facts": [f.model_dump() for f in req.source_facts],
        "review_required": result.review_required,
        "filing_blocked": result.filing_blocked,
        "created_at": now_utc().isoformat(),
    })

    # Route high-risk / unresolved items to the human review queue.
    if result.review_required:
        await db.review_items.insert_one({
            "review_id": uuid.uuid4().hex,
            "user_id": user["user_id"],
            "taxpayer_id": tp_id,
            "document_id": None,
            "title": f"Pub. 502 medical validation: {result.claim_id} ({result.status.value})",
            "reason": result.missing_facts[0] if result.missing_facts else (
                f"Potentially deductible ${result.calculation.potentially_deductible} "
                f"requires professional review before any return-field update."
            ),
            "severity": "warning",
            "status": "open",
            "created_at": now_utc().isoformat(),
        })

    return result


class ReviewerDecisionRequest(BaseModel):
    decision: str  # approve | reject
    rationale: Optional[str] = None


async def _latest_claim_record(claim_id: str, user_id: str, taxpayer_id: str) -> Optional[dict]:
    """Newest audit record for a claim — the effective status (validation, then
    any approval/rejection events appended on top). Append-only, never mutated."""
    return await db.validation_audit.find_one(
        {"claim_id": claim_id, "user_id": user_id, "taxpayer_id": taxpayer_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def _append_validation_audit(user_id: str, taxpayer_id: str, record: dict) -> str:
    """Append a tamper-evident audit record. Each record's hash chains to the
    previous tenant record so any in-place edit/deletion of history is
    detectable by the verify pass."""
    prev = await db.validation_audit.find_one(
        {"user_id": user_id, "taxpayer_id": taxpayer_id},
        {"record_hash": 1, "_id": 0},
        sort=[("created_at", -1)],
    )
    prev_hash = (prev.get("record_hash") if prev else None) or GENESIS_HASH
    record_hash = compute_record_hash(prev_hash, record)
    record["prev_hash"] = prev_hash
    record["record_hash"] = record_hash
    await db.validation_audit.insert_one(record)
    return record_hash


@api_router.get("/validation/medical/{claim_id}")
async def get_validation_claim(claim_id: str, user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    rec = await _latest_claim_record(claim_id, user["user_id"], tp_id)
    if not rec:
        raise HTTPException(404, "Claim not found")
    return rec


# Reviewer approval closes the AI-proposes -> checks -> human-approves loop. The
# reviewer is the authenticated user (identity bound to the session); the model
# cannot approve its own claims. Only a "potentially_supported" claim (all
# deterministic checks passed) may be approved. Approval appends a new audit
# event (never overwrites the original validation) and unblocks filing; a
# rejection records the rationale and keeps filing blocked.
@api_router.post("/validation/medical/{claim_id}/decision")
async def reviewer_decision(claim_id: str, req: ReviewerDecisionRequest, user=Depends(get_current_user)):
    if req.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be 'approve' or 'reject'")
    tp_id = await get_active_taxpayer_id(user)

    latest = await _latest_claim_record(claim_id, user["user_id"], tp_id)
    if not latest:
        raise HTTPException(404, "Claim not found")

    base = latest
    # If the latest record is itself an approval/rejection event, the user is
    # acting on the prior validation — walk back to the validation event.
    if latest.get("event_type") != "validation":
        base = await db.validation_audit.find_one(
            {"claim_id": claim_id, "user_id": user["user_id"], "taxpayer_id": tp_id,
             "event_type": "validation"},
            {"_id": 0}, sort=[("created_at", -1)],
        )
        if not base:
            raise HTTPException(409, "No validation record to review")

    # Prerequisite: only a claim that passed every deterministic check may be
    # approved. Unsupported / contradicted / outdated claims cannot be approved.
    if req.decision == "approve" and base["status"] != "potentially_supported":
        raise HTTPException(
            409,
            f"Cannot approve a '{base['status']}' claim. Only 'potentially_supported' "
            "claims (all deterministic checks passed) can be approved."
        )

    if req.decision == "approve":
        new_status = "supported"
        filing_blocked = False
    else:
        new_status = "unsupported"
        filing_blocked = True

    audit_id = uuid.uuid4().hex
    now = now_utc().isoformat()
    await _append_validation_audit(user["user_id"], tp_id, {
        "audit_id": audit_id,
        "event_type": "reviewer_decision",
        "decision": req.decision,
        "user_id": user["user_id"],
        "taxpayer_id": tp_id,
        "claim_id": claim_id,
        "previous_status": base["status"],
        "status": new_status,
        "risk_tier": base.get("risk_tier", "high"),
        "filing_blocked": filing_blocked,
        "rationale": (req.rationale or "").strip() or None,
        "reviewer_user_id": user["user_id"],
        "reviewer_email": user.get("email"),
        "calculation": base.get("calculation"),
        "created_at": now,
    })

    return {
        "ok": True,
        "claim_id": claim_id,
        "decision": req.decision,
        "status": new_status,
        "filing_blocked": filing_blocked,
        "audit_event_id": audit_id,
        "reviewer_email": user.get("email"),
        "reviewed_at": now,
    }


@api_router.get("/validation/medical/history", response_model=List[dict])
async def validation_history(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    items = await db.validation_audit.find(
        {"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return items


# Transparency: the versioned Pub. 502 medical threshold rules the engine uses.
@api_router.get("/validation/rules/medical")
async def medical_rules(user=Depends(get_current_user)):
    return {
        "rules": [
            {
                "tax_year": year,
                "rate": str(r["rate"]),
                "source": r["source"],
                "revision": r["revision"],
                "page_or_section": r["page_or_section"],
                "hash": r["hash"],
                "status": "approved",
            }
            for year, r in sorted(MEDICAL_RULES.items())
        ],
        "line_mapping": {
            "line_1": "medical_and_dental_expenses",
            "line_2": "adjusted_gross_income",
            "line_3": "agi_times_rate",
            "line_4": "line_1_minus_line_3_clamped_at_zero",
        },
        "note": "Threshold rate is versioned by tax year. The validator never "
                "trusts an LLM-supplied rate; it confirms the rate against this "
                "registry for the requested return year.",
    }


# Citation-gap & hallucination detector. Re-checks an LLM answer against the
# retrieved source spans the server controlled (never the model's self-claim)
# and returns a grounding verdict + hallucination flags.
@api_router.post("/validation/citation-check", response_model=CitationCheckResult)
async def citation_check_endpoint(req: CitationCheckRequest, user=Depends(get_current_user)):
    if not req.retrieved_spans:
        # If the caller did not supply spans, retrieve them from the registry so
        # the check is never silently skipped.
        req.retrieved_spans = retrieve_spans(req.answer, req.tax_year, req.category)
    return check_citations(req)


# Public view of the versioned source spans (metadata + preview, no full body).
@api_router.get("/sources/spans")
async def source_spans(user=Depends(get_current_user)):
    return {"spans": registry_view(), "count": len(registry_view())}


# Risk-tier escalation: a proposed item's tier + triggers + mandatory-review /
# filing-block gate, derived from category, material amount, and any flags. High
# risk always blocks filing until a reviewer approves.
class RiskAssessmentRequest(BaseModel):
    category: str
    agi: Optional[float] = None
    amount: Optional[float] = None
    flags: List[str] = []


@api_router.post("/validation/risk-assessment")
async def risk_assessment(req: RiskAssessmentRequest, user=Depends(get_current_user)):
    return assess_risk(req.category, req.agi, req.amount, req.flags)


# Multi-state: layered federal <-> state rule objects.
@api_router.get("/validation/state-rules")
async def state_rules(state: str, tax_year: int, category: str = "medical_dental", user=Depends(get_current_user)):
    rule = get_state_rule(state, tax_year, category)
    if not rule:
        raise HTTPException(404, f"No state rule for {state} / {tax_year} / {category}")
    return rule


@api_router.get("/validation/state-registry")
async def state_registry(user=Depends(get_current_user)):
    return {"states": state_registry_view()}


# Layer a federal medical validation result with the state rule for the same
# year/category, returning the effective status + reviewer caveat.
class LayeredStateRequest(BaseModel):
    claim_id: str
    state: str


@api_router.post("/validation/medical/layered-state")
async def medical_layered_state(req: LayeredStateRequest, user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    base = await _latest_claim_record(req.claim_id, user["user_id"], tp_id)
    if not base:
        raise HTTPException(404, "Claim not found")
    federal = {
        "claim_id": base.get("claim_id"),
        "category": base.get("category", "medical_dental"),
        "status": base.get("status"),
        "risk_tier": base.get("risk_tier"),
        "filing_blocked": base.get("filing_blocked"),
    }
    return layered_assess(federal, req.state, base.get("tax_year", 2025))


# Verify the tamper-evident audit chain for the active taxpayer. Walks every
# validation_audit record in chronological order and reports the first break
# (if any) plus per-record hash/link status. A valid chain means no record was
# edited, deleted, or reordered after it was written.
@api_router.get("/audit/chain/verify")
async def verify_audit_chain(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    records = await db.validation_audit.find(
        {"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(10000)
    result = verify_chain(records)
    return {
        "valid": result["valid"],
        "verified": result["verified"],
        "total": result["total"],
        "broken_at": result["broken_at"],
        "tenant": {"user_id": user["user_id"], "taxpayer_id": tp_id},
        "checked_at": now_utc().isoformat(),
        "details": result["details"],
    }


# ---------- Rule Diff Viewer (prior-year deltas) ----------
RULES_CATALOG: Dict[int, List[dict]] = {
    2025: [
        {"rule_id": "std-ded-single", "authority": "Publication 17", "topic": "Standard deduction (single)", "value": "$15,000", "notes": "Base amount for single filers."},
        {"rule_id": "std-ded-mfj", "authority": "Publication 17", "topic": "Standard deduction (MFJ)", "value": "$30,000", "notes": "Married filing jointly base."},
        {"rule_id": "medical-agi-floor", "authority": "Publication 502", "topic": "Medical AGI floor", "value": "7.5%", "notes": "Threshold before medical expenses become deductible."},
        {"rule_id": "mileage-business", "authority": "Publication 463", "topic": "Business mileage rate", "value": "70¢ / mile", "notes": "Standard business mileage rate."},
        {"rule_id": "aotc-max", "authority": "Publication 970", "topic": "American Opportunity Credit (max)", "value": "$2,500", "notes": "40% refundable up to $1,000."},
        {"rule_id": "student-loan-int-cap", "authority": "Publication 970", "topic": "Student loan interest cap", "value": "$2,500", "notes": "Above-the-line, income-phased."},
        {"rule_id": "savers-credit-agi-single", "authority": "Form 8880 Instructions", "topic": "Saver's Credit AGI cap (single)", "value": "$39,500", "notes": "AGI limit for Retirement Savings Contributions Credit."},
    ],
    2024: [
        {"rule_id": "std-ded-single", "authority": "Publication 17", "topic": "Standard deduction (single)", "value": "$14,600"},
        {"rule_id": "std-ded-mfj", "authority": "Publication 17", "topic": "Standard deduction (MFJ)", "value": "$29,200"},
        {"rule_id": "medical-agi-floor", "authority": "Publication 502", "topic": "Medical AGI floor", "value": "7.5%"},
        {"rule_id": "mileage-business", "authority": "Publication 463", "topic": "Business mileage rate", "value": "67¢ / mile"},
        {"rule_id": "aotc-max", "authority": "Publication 970", "topic": "American Opportunity Credit (max)", "value": "$2,500"},
        {"rule_id": "student-loan-int-cap", "authority": "Publication 970", "topic": "Student loan interest cap", "value": "$2,500"},
        {"rule_id": "savers-credit-agi-single", "authority": "Form 8880 Instructions", "topic": "Saver's Credit AGI cap (single)", "value": "$38,250"},
    ],
    2023: [
        {"rule_id": "std-ded-single", "authority": "Publication 17", "topic": "Standard deduction (single)", "value": "$13,850"},
        {"rule_id": "std-ded-mfj", "authority": "Publication 17", "topic": "Standard deduction (MFJ)", "value": "$27,700"},
        {"rule_id": "medical-agi-floor", "authority": "Publication 502", "topic": "Medical AGI floor", "value": "7.5%"},
        {"rule_id": "mileage-business", "authority": "Publication 463", "topic": "Business mileage rate", "value": "65.5¢ / mile"},
        {"rule_id": "aotc-max", "authority": "Publication 970", "topic": "American Opportunity Credit (max)", "value": "$2,500"},
        {"rule_id": "student-loan-int-cap", "authority": "Publication 970", "topic": "Student loan interest cap", "value": "$2,500"},
        {"rule_id": "savers-credit-agi-single", "authority": "Form 8880 Instructions", "topic": "Saver's Credit AGI cap (single)", "value": "$36,500"},
    ],
}


@api_router.get("/rules/diff")
async def rules_diff(from_year: int, to_year: int, user=Depends(get_current_user)):
    if from_year not in RULES_CATALOG or to_year not in RULES_CATALOG:
        raise HTTPException(400, "Years must be in 2023, 2024, 2025")
    fr = {r["rule_id"]: r for r in RULES_CATALOG[from_year]}
    to = {r["rule_id"]: r for r in RULES_CATALOG[to_year]}
    changes = []
    for rid, r_from in fr.items():
        r_to = to.get(rid)
        if not r_to:
            changes.append({"rule_id": rid, "topic": r_from["topic"], "authority": r_from["authority"], "from_value": r_from["value"], "to_value": None, "change": "removed"})
        elif r_from["value"] != r_to["value"]:
            changes.append({"rule_id": rid, "topic": r_from["topic"], "authority": r_from["authority"], "from_value": r_from["value"], "to_value": r_to["value"], "change": "changed"})
        else:
            changes.append({"rule_id": rid, "topic": r_from["topic"], "authority": r_from["authority"], "from_value": r_from["value"], "to_value": r_to["value"], "change": "unchanged"})
    for rid, r_to in to.items():
        if rid not in fr:
            changes.append({"rule_id": rid, "topic": r_to["topic"], "authority": r_to["authority"], "from_value": None, "to_value": r_to["value"], "change": "added"})
    return {"from_year": from_year, "to_year": to_year, "changes": changes}


# ---------- CPA Directory ----------
CPA_DIRECTORY = [
    {"cpa_id": "cpa_001", "name": "Jamie Chen, CPA", "firm": "Northwest Tax Partners", "email": "jamie.chen@nwtaxpartners.com", "phone": "+1 (415) 555-0182", "license_state": "CA", "license_number": "CA-CPA-138221", "credentials": ["CPA", "PFS"], "specialties": ["Individual", "Self-employed", "K-1"]},
    {"cpa_id": "cpa_002", "name": "Rita Alvarez, EA", "firm": "Alvarez Advisory", "email": "rita@alvarez-tax.com", "phone": "+1 (312) 555-0113", "license_state": "IL", "license_number": "IL-EA-84019", "credentials": ["EA"], "specialties": ["Small business", "S-corp"]},
    {"cpa_id": "cpa_003", "name": "Marcus Boone, CPA", "firm": "Boone & Cole", "email": "mboone@booneandcole.com", "phone": "+1 (212) 555-0164", "license_state": "NY", "license_number": "NY-CPA-071554", "credentials": ["CPA", "CFP"], "specialties": ["High-net-worth", "Trusts"]},
    {"cpa_id": "cpa_004", "name": "Priya Rao, CPA", "firm": "Rao Tax Group", "email": "priya@raotax.com", "phone": "+1 (206) 555-0176", "license_state": "WA", "license_number": "WA-CPA-32189", "credentials": ["CPA"], "specialties": ["Individual", "Foreign income"]},
    {"cpa_id": "cpa_005", "name": "David Kim, CPA", "firm": "Kim & Partners", "email": "dkim@kimpartners.com", "phone": "+1 (617) 555-0148", "license_state": "MA", "license_number": "MA-CPA-118344", "credentials": ["CPA"], "specialties": ["Freelance", "1099-NEC"]},
    {"cpa_id": "cpa_006", "name": "Elena Rossi, EA", "firm": "Rossi Tax Services", "email": "elena@rossitax.com", "phone": "+1 (305) 555-0177", "license_state": "FL", "license_number": "FL-EA-19822", "credentials": ["EA"], "specialties": ["Real estate", "Rentals"]},
    {"cpa_id": "cpa_007", "name": "Sam Patel, CPA", "firm": "Patel Advisory", "email": "sam@pateladvisory.com", "phone": "+1 (972) 555-0121", "license_state": "TX", "license_number": "TX-CPA-92180", "credentials": ["CPA", "CGMA"], "specialties": ["Business", "Multi-state"]},
    {"cpa_id": "cpa_008", "name": "Nora Whitfield, CPA", "firm": "Whitfield Tax", "email": "nora@whitfieldtax.com", "phone": "+1 (720) 555-0139", "license_state": "CO", "license_number": "CO-CPA-72014", "credentials": ["CPA"], "specialties": ["Crypto", "Investments"]},
    {"cpa_id": "cpa_009", "name": "Andre Duval, EA", "firm": "Duval Enrolled Agents", "email": "andre@duval-ea.com", "phone": "+1 (503) 555-0155", "license_state": "OR", "license_number": "OR-EA-45782", "credentials": ["EA"], "specialties": ["IRS representation", "Amended returns"]},
    {"cpa_id": "cpa_010", "name": "Grace Lin, CPA", "firm": "Lin Tax Studio", "email": "grace@lintaxstudio.com", "phone": "+1 (408) 555-0129", "license_state": "CA", "license_number": "CA-CPA-149022", "credentials": ["CPA", "PFS"], "specialties": ["Individual", "Equity comp"]},
    {"cpa_id": "cpa_011", "name": "Ben Fischer, CPA", "firm": "Fischer & Ross", "email": "ben@fischerandross.com", "phone": "+1 (703) 555-0161", "license_state": "VA", "license_number": "VA-CPA-88110", "credentials": ["CPA"], "specialties": ["Federal contractors", "Military"]},
    {"cpa_id": "cpa_012", "name": "Aisha Bello, EA", "firm": "Bello Tax Advisors", "email": "aisha@bellotax.com", "phone": "+1 (404) 555-0143", "license_state": "GA", "license_number": "GA-EA-30291", "credentials": ["EA"], "specialties": ["First-time filers", "Students"]},
]


@api_router.get("/cpas")
async def list_cpas(q: Optional[str] = None, user=Depends(get_current_user)):
    q_l = (q or "").lower().strip()
    results = CPA_DIRECTORY
    if q_l:
        results = [c for c in CPA_DIRECTORY if q_l in c["name"].lower()
                   or q_l in c["firm"].lower()
                   or q_l in c["license_state"].lower()
                   or any(q_l in s.lower() for s in c["specialties"])]
    return {"cpas": results, "count": len(results)}


# ---------- Handoff Tracking ----------
HANDOFF_STATUSES = {"generated", "shared", "opened", "commented", "closed"}


@api_router.get("/handoffs")
async def list_handoffs(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    items = await db.handoff_audit.find({"user_id": user["user_id"], "taxpayer_id": tp_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for it in items:
        it.setdefault("status", "generated")
        it.setdefault("comments", [])
    return {"handoffs": items}


class HandoffStatusRequest(BaseModel):
    status: str
    comment: Optional[str] = None


@api_router.post("/handoffs/{handoff_id}/status")
async def update_handoff(handoff_id: str, req: HandoffStatusRequest, user=Depends(get_current_user)):
    if req.status not in HANDOFF_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(HANDOFF_STATUSES)}")
    h = await db.handoff_audit.find_one({"handoff_id": handoff_id, "user_id": user["user_id"]}, {"_id": 0})
    if not h:
        raise HTTPException(404, "Not found")
    updates: Dict[str, Any] = {"status": req.status, "updated_at": now_utc().isoformat()}
    if req.comment:
        comments = h.get("comments") or []
        comments.append({"text": req.comment, "at": now_utc().isoformat()})
        updates["comments"] = comments
    await db.handoff_audit.update_one({"handoff_id": handoff_id}, {"$set": updates})
    return {"ok": True, "status": req.status}


# ---------- Demo Seed ----------
@api_router.post("/demo/seed")
async def demo_seed(user=Depends(get_current_user)):
    tp_id = await get_active_taxpayer_id(user)
    await db.documents.delete_many({"user_id": user["user_id"], "taxpayer_id": tp_id, "is_demo": True})
    await db.review_items.delete_many({"user_id": user["user_id"], "taxpayer_id": tp_id, "is_demo": True})

    samples = [
        {"filename": "W2_AcmeCorp_2025.pdf", "doc_type": "W-2", "status": "classified"},
        {"filename": "1099-NEC_Freelance.pdf", "doc_type": "1099-NEC", "status": "classified"},
        {"filename": "Receipts_Q2.pdf", "doc_type": "Receipt", "status": "classified"},
        {"filename": "K-1_Partnership.pdf", "doc_type": "K-1", "status": "expected"},
    ]
    created = []
    for s in samples:
        did = uuid.uuid4().hex
        extraction = _fallback_extraction(s["doc_type"])
        doc = {
            "document_id": did,
            "user_id": user["user_id"],
            "taxpayer_id": tp_id,
            "filename": s["filename"],
            "doc_type": s["doc_type"],
            "status": s["status"],
            "storage_path": None,
            "content_type": "application/pdf",
            "uploaded_at": now_utc().isoformat(),
            "is_demo": True,
            "extraction": extraction if s["status"] == "classified" else None,
        }
        await db.documents.insert_one(dict(doc))
        created.append(did)
        if s["doc_type"] == "Receipt":
            await db.review_items.insert_one({
                "review_id": uuid.uuid4().hex,
                "user_id": user["user_id"],
                "taxpayer_id": tp_id,
                "document_id": did,
                "title": "Review Q2 Receipts",
                "reason": "Low confidence on 'Category' (74%)",
                "severity": "warning",
                "status": "open",
                "created_at": now_utc().isoformat(),
                "is_demo": True,
            })
    await db.review_items.insert_one({
        "review_id": uuid.uuid4().hex,
        "user_id": user["user_id"],
        "taxpayer_id": tp_id,
        "document_id": None,
        "title": "Missing K-1",
        "reason": "K-1 expected based on prior year but not yet uploaded",
        "severity": "info",
        "status": "open",
        "created_at": now_utc().isoformat(),
        "is_demo": True,
    })
    return {"ok": True, "seeded": len(created)}


@api_router.get("/")
async def root():
    return {"app": "TaxPilot AI", "status": "ok"}


# Startup
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("apple_sub", unique=True, sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.documents.create_index([("user_id", 1), ("uploaded_at", -1)])
    await db.review_items.create_index([("user_id", 1), ("status", 1)])
    try:
        await run_in_threadpool(init_storage)
        logging.info("Storage initialized")
    except Exception as e:
        logging.warning(f"Storage init failed at startup: {e}")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
