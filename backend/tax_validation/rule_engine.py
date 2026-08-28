"""Deterministic Pub. 502 medical-expense validator.

The LLM may propose a medical deduction, but eligibility is decided here by
versioned rules and exact arithmetic — never by the model. This implements the
"AI proposes -> deterministic validator -> risk tier -> human approval" core of
the TaxPilot design spec.

Medical expenses are treated as HIGH risk (material, fact-intensive) in every
case, so the validator never returns "supported" on its own: it returns at best
"potentially_supported", and only a separate authenticated reviewer approval can
promote a claim to "supported" and unblock filing. No source -> no definitive
answer; no verified facts -> no deduction eligibility.
"""
from decimal import Decimal, ROUND_HALF_UP

from .models import (
    MedicalClaimRequest,
    MedicalValidationResult,
    Jurisdiction,
    Calculation,
    RuleRef,
    ViolationStatus,
    RiskTier,
)

CENT = Decimal("0.01")

# Versioned rule objects for the Pub. 502 medical AGI floor. The threshold rate
# is NOT hard-coded globally — it is selected by tax year from this registry so
# older returns use the authority that applied then. (7.5% applies 2023-2025;
# older publications described a 10% rate for some taxpayers in prior periods.)
MEDICAL_RULES = {
    2023: {
        "rate": Decimal("0.075"),
        "source": "Publication 502",
        "revision": "2023",
        "page_or_section": "How to Figure Your Deduction",
        "hash": "sha256:2b4c8f19a0e73c88",
    },
    2024: {
        "rate": Decimal("0.075"),
        "source": "Publication 502",
        "revision": "2024",
        "page_or_section": "How to Figure Your Deduction",
        "hash": "sha256:2b4c8f19a0e73c88",
    },
    2025: {
        "rate": Decimal("0.075"),
        "source": "Publication 502",
        "revision": "2024",
        "page_or_section": "How to Figure Your Deduction",
        "hash": "sha256:2b4c8f19a0e73c88",
    },
}

LINE_MAPPING = {
    "line_1": "medical_and_dental_expenses",
    "line_2": "adjusted_gross_income",
    "line_3": "agi_times_threshold_rate",
    "line_4": "line_1_minus_line_3_clamped_at_zero",
}


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def validate_medical(claim: MedicalClaimRequest) -> MedicalValidationResult:
    flags: list[str] = []
    missing_facts: list[str] = []

    tax_year = claim.tax_year
    rule = MEDICAL_RULES.get(tax_year)
    if not rule:
        # No approved rule for the requested year -> never fall back to a newer pub.
        return MedicalValidationResult(
            claim_id=claim.claim_id or "",
            tax_year=tax_year,
            jurisdiction=claim.jurisdiction,
            status=ViolationStatus.outdated,
            risk_tier=RiskTier.high,
            flags=["NO_APPROVED_RULE_FOR_TAX_YEAR"],
            calculation=Calculation(),
            source_status="outdated",
            missing_facts=[f"Approved Pub. 502 rule for tax year {tax_year}"],
            rule_ref=claim.rule_ref,
            filing_blocked=True,
            review_required=False,
        )

    agi = _money(claim.agi)
    paid_medical = _money(claim.paid_medical)
    reimbursements = _money(claim.reimbursements)
    approved_rate = rule["rate"]

    # --- Hallucination guard: if the proposing model assumed a threshold rate,
    # confirm it matches the approved tax-year rule. The validator never trusts
    # the model's rate. ---
    if claim.threshold_rate is not None and _money(claim.threshold_rate) != approved_rate:
        flags.append("THRESHOLD_RATE_MISMATCH")

    # --- The AGI floor base MUST be adjusted gross income. The caller supplies
    # agi directly; negative or nonsensical values are rejected rather than
    # silently used in the threshold. ---
    if agi < 0:
        flags.append("INVALID_AGI")
    if paid_medical < 0 or reimbursements < 0:
        flags.append("INVALID_AMOUNT")
    if not claim.itemizing:
        flags.append("NOT_ITEMIZING")
    if not claim.qualified_expense:
        flags.append("NONQUALIFYING_EXPENSE")
    if not claim.paid_in_tax_year:
        flags.append("PAYMENT_YEAR_UNVERIFIED")
    if reimbursements > paid_medical:
        flags.append("REIMBURSEMENT_EXCEEDS_EXPENSE")

    # --- Deterministic calculation. Reimbursements are subtracted first, then
    # the AGI floor is applied to AGI (never to gross income / taxable income /
    # MAGI / refund amount, and never per-receipt). Only the excess is deductible. ---
    net_expense = max(Decimal("0.00"), paid_medical - reimbursements)
    threshold_amount = _money(agi * approved_rate)
    potentially_deductible = max(Decimal("0.00"), net_expense - threshold_amount)

    # --- Grade the result (five statuses). "supported" is only set later by an
    # authenticated reviewer approval — the validator itself tops out at
    # "potentially_supported". ---
    if not claim.qualified_expense:
        status = ViolationStatus.contradicted  # an exclusion defeats the claim
    elif not claim.itemizing:
        status = ViolationStatus.unsupported   # required condition (itemization) not met
    elif flags:
        # Missing facts / invalid inputs / threshold mismatch -> stop short of a
        # definitive answer and route to human review (medical is always high-risk).
        status = ViolationStatus.human_review_required
        if "PAYMENT_YEAR_UNVERIFIED" in flags:
            missing_facts.append("Confirmation that the expense was paid during the tax year")
        if "THRESHOLD_RATE_MISMATCH" in flags:
            missing_facts.append(f"Threshold rate must be {approved_rate} ({approved_rate * Decimal('100')}% of AGI) for {tax_year}")
        if "INVALID_AGI" in flags:
            missing_facts.append("Adjusted gross income (AGI) for the return year")
        if "REIMBURSEMENT_EXCEEDS_EXPENSE" in flags:
            missing_facts.append("Reimbursement amount (exceeds the claimed paid expense)")
    else:
        status = ViolationStatus.potentially_supported

    review_required = status in {ViolationStatus.potentially_supported, ViolationStatus.human_review_required}

    return MedicalValidationResult(
        claim_id=claim.claim_id or "",
        tax_year=tax_year,
        jurisdiction=claim.jurisdiction,
        status=status,
        risk_tier=RiskTier.high,
        flags=flags,
        calculation=Calculation(
            agi=str(agi),
            qualified_paid=str(paid_medical),
            reimbursements=str(reimbursements),
            net_qualified_expense=str(net_expense),
            threshold_rate=str(approved_rate),
            threshold_amount=str(threshold_amount),
            potentially_deductible=str(potentially_deductible),
            line_mapping=LINE_MAPPING,
        ),
        source_status="current_approved",
        rule_ref=RuleRef(
            source=rule["source"],
            revision=rule["revision"],
            page_or_section=rule["page_or_section"],
            hash=rule["hash"],
        ),
        missing_facts=missing_facts,
        filing_blocked=True,          # never auto-file; unblocked only by reviewer approval
        review_required=review_required,
    )
