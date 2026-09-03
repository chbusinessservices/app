"""Risk-tier escalation engine.

Decides, from a category + material facts + any deterministic flags, whether a
proposed item is high-risk and therefore must go through human review before
any return field is populated or any filing/export happens. This generalizes
the medical validator's always-high rule to all categories.

High-risk triggers (per design spec):
  - material amount relative to AGI (>= 10%)
  - audit hot-spot category (medical, home office, crypto, foreign assets, K-1,
    rental/real estate, ACA premium credit reconciliation)
  - material deterministic flags (wrong tax year, threshold-rate mismatch,
    conclusion stronger than source, nonqualifying expense, unsupported citation)

A high-risk item always requires human review and keeps filing blocked until a
reviewer approves it (the approval is a separate, authenticated step).
"""
from typing import List, Optional

HIGH_RISK_CATEGORIES = {
    "medical_dental",
    "home_office",
    "crypto",
    "foreign_assets",
    "k1_passthrough",
    "rental_real_estate",
    "aca_premium_credit",
    "canceled_debt",
}

MATERIAL_RATIO = 0.10  # item impact >= 10% of AGI is material

MATERIAL_FLAGS = {
    "THRESHOLD_RATE_MISMATCH",
    "CONCLUSION_EXCEEDS_SOURCE",
    "WRONG_TAX_YEAR",
    "UNSUPPORTED_CITATION",
    "NONQUALIFYING_EXPENSE",
    "INVALID_AGI",
}


def assess_risk(
    category: str,
    agi: Optional[float] = None,
    amount: Optional[float] = None,
    flags: Optional[List[str]] = None,
) -> dict:
    flags = flags or []
    triggers: List[str] = []
    tier = "low"

    if agi and agi > 0 and amount and (amount / agi) >= MATERIAL_RATIO:
        triggers.append("MATERIAL_AMOUNT_RELATIVE_TO_AGI")
        tier = "high"

    if category in HIGH_RISK_CATEGORIES:
        triggers.append("AUDIT_HOTSPOT_CATEGORY")
        tier = "high"

    for f in flags:
        if f in MATERIAL_FLAGS:
            triggers.append(f"MATERIAL_FLAG:{f}")
            tier = "high"

    review_required = tier == "high" or bool(flags)
    return {
        "category": category,
        "risk_tier": tier,
        "triggers": triggers,
        "review_required": review_required,
        "filing_blocked": review_required,  # unblocked only by reviewer approval
        "note": (
            "High-risk: human review required and filing blocked until a reviewer "
            "approves. No return field may be populated from this item before then."
            if review_required else
            "Low-risk: deterministic checks passed; still subject to the standard "
            "reviewer-approval gate before any filing/export."
        ),
    }
