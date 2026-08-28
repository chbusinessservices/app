"""Tamper-evident, append-only audit chaining for validation decisions.

Each audit record stores:
  - prev_hash: the record_hash of the immediately preceding record for the same
    tenant (user_id + taxpayer_id), or all-zero if it is the first record.
  - record_hash: sha256(prev_hash || canonical(payload-without-hashes)).

Because every record's hash depends on its predecessor's hash, any in-place
edit, deletion, or reordering of an earlier record breaks the chain and is
detected by the verify pass. This is the "cryptographic chaining or equivalent
tamper evidence" the design spec requires. Records are still insert-only by
application convention; the chain makes tampering *detectable*, not just relied
upon.
"""
import hashlib
import json

GENESIS_HASH = "0" * 64


def _canonical(payload: dict) -> bytes:
    """Deterministic encoding so the same payload always hashes identically."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def compute_record_hash(prev_hash: str, payload: dict) -> str:
    """Hash the canonical payload concatenated with the previous record's hash."""
    h = hashlib.sha256()
    h.update(prev_hash.encode("utf-8"))
    h.update(_canonical(payload))
    return h.hexdigest()


def audit_payload(record: dict) -> dict:
    """Return the record without its own hash fields, for use as the chained
    payload (prev_hash is an input, never part of the hashed payload)."""
    return {k: v for k, v in record.items() if k not in ("record_hash", "prev_hash")}


def verify_chain(records: list[dict]) -> dict:
    """Walk a chronologically ordered list of audit records and verify the chain.

    Returns {"valid": bool, "verified": n, "broken_at": index|None, "details": [...]}.
    A record is valid when its record_hash equals recomputed hash from its
    prev_hash + payload, AND its prev_hash equals the previous record's
    record_hash (or GENESIS for the first record).
    """
    verified = 0
    details = []
    prev_hash = GENESIS_HASH
    broken_at = None
    for i, rec in enumerate(records):
        got_hash = rec.get("record_hash")
        got_prev = rec.get("prev_hash")
        payload = audit_payload(rec)
        expected_hash = compute_record_hash(prev_hash, payload)
        hash_ok = (got_hash == expected_hash)
        link_ok = (got_prev == prev_hash)
        ok = hash_ok and link_ok
        if ok:
            verified += 1
        else:
            if broken_at is None:
                broken_at = i
        details.append({
            "index": i,
            "audit_id": rec.get("audit_id"),
            "event_type": rec.get("event_type"),
            "hash_ok": hash_ok,
            "link_ok": link_ok,
            "expected_hash": expected_hash[:12],
            "record_hash": (got_hash or "")[:12],
        })
        # advance: the next record's prev_hash must equal this record's record_hash
        prev_hash = got_hash if got_hash is not None else expected_hash
    return {
        "valid": broken_at is None,
        "verified": verified,
        "total": len(records),
        "broken_at": broken_at,
        "details": details,
    }
