"""Citation-gap & hallucination detector for LLM tax answers.

The chat model produces an answer plus self-reported citations, but the model's
own self-assessment is not trustworthy. This module deterministically re-checks
the answer against the *retrieved* source spans (the ground truth the answer was
supposed to come from) and flags common hallucination patterns:

  - UNSUPPORTED_CITATION   cites a publication not present in retrieved spans
  - WRONG_TAX_YEAR         cited source does not cover the requested tax year
  - DEDUCTION_CREDIT_CONFUSION  calls a credit a deduction (or vice versa)
  - MISSING_THRESHOLD     definitive benefit claim with no threshold/condition
  - CONCLUSION_EXCEEDS_SOURCE  definitive claim no retrieved span supports
  - UNSUPPORTED_NUMBER    a dollar/percent figure absent from every span

It does NOT trust any field the model asserts about itself; it only trusts the
retrieved spans the server controlled. Output is a grounding verdict the chat /
review pipeline can gate on (gaps or unsupported -> requires_review True).
"""
import re
from typing import List, Optional
from pydantic import BaseModel, Field

_AMOUNT = re.compile(r"\$[\d,]+(?:\.\d+)?")
_PERCENT = re.compile(r"\d+(?:\.\d+)?%")
_DEFINITIVE = re.compile(
    r"\b(you (can|may|are able to|qualify|are eligible) "
    r"(deduct|claim|take|receive|get|exclude|contribute)|"
    r"you (qualify|are eligible)\b|"
    r"deductible\b|fully deductible)",
    re.IGNORECASE,
)


class SourceSpan(BaseModel):
    """A retrieved chunk of an approved IRS publication that grounds an answer."""
    source_id: str
    publication: str
    revision: str
    tax_years: List[int] = []
    page_or_section: Optional[str] = None
    hash: Optional[str] = None
    text: str


class AnswerCitation(BaseModel):
    source: str
    note: Optional[str] = None
    page_or_section: Optional[str] = None


class CitationCheckRequest(BaseModel):
    answer: str
    citations: List[AnswerCitation] = []
    tax_year: int
    category: str = "general"
    retrieved_spans: List[SourceSpan] = []


class VerifiedCitation(BaseModel):
    source: str
    status: str  # verified | not_retrieved | wrong_tax_year
    note: Optional[str] = None


class CitationCheckResult(BaseModel):
    grounding_status: str  # grounded | gaps | unsupported
    flags: List[str] = []
    verified_citations: List[VerifiedCitation] = []
    unsupported_numbers: List[str] = []
    requires_review: bool = True
    risk_tier: str = "high"
    explanation: str = ""


# Per-category profile: the official benefit type and the threshold/condition
# terms a grounded answer for that category must engage with.
CATEGORY_PROFILE = {
    "medical_dental": {
        "official_type": "deduction",
        "threshold_terms": ["7.5%", "agi", "floor", "itemiz", "reimburse"],
        "claim_terms": ["medical", "dental", "deduct"],
    },
    "home_office": {
        "official_type": "deduction",
        "threshold_terms": ["exclusive", "regular", "business use", "principal"],
        "claim_terms": ["home office", "deduct"],
    },
    "se_health_ins": {
        "official_type": "deduction",
        "threshold_terms": ["self-employed", "net profit", "schedule 1"],
        "claim_terms": ["health insurance", "premium", "deduct"],
    },
    "retirement_savers": {
        "official_type": "credit",
        "threshold_terms": ["agi", "income", "limit", "phase"],
        "claim_terms": ["saver", "retirement", "credit"],
    },
    "student_loan_int": {
        "official_type": "deduction",
        "threshold_terms": ["2,500", "income", "phase", "modified agi"],
        "claim_terms": ["student loan", "interest", "deduct"],
    },
}


def _norm(pub: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (pub or "").lower())


def _extract_numbers(answer: str) -> List[str]:
    return _AMOUNT.findall(answer) + _PERCENT.findall(answer)


def _is_definitive(answer: str) -> bool:
    return bool(_DEFINITIVE.search(answer))


def check_citations(req: CitationCheckRequest) -> CitationCheckResult:
    flags: List[str] = []
    verified: List[VerifiedCitation] = []
    unsupported_numbers: List[str] = []

    # Index retrieved spans by normalized publication name.
    spans_by_pub = {_norm(s.publication): s for s in req.retrieved_spans}

    # --- Verify each citation against the retrieved spans (not the model's word) ---
    for c in req.citations:
        key = _norm(c.source)
        span = spans_by_pub.get(key)
        if not span:
            flags.append("UNSUPPORTED_CITATION")
            verified.append(VerifiedCitation(source=c.source, status="not_retrieved", note=c.note))
            continue
        if req.tax_year not in span.tax_years:
            flags.append("WRONG_TAX_YEAR")
            verified.append(VerifiedCitation(source=c.source, status="wrong_tax_year", note=c.note))
        else:
            verified.append(VerifiedCitation(source=c.source, status="verified", note=c.note))

    # Grounding (numbers + claim support) only counts spans valid for the tax
    # year; year-ineligible spans are kept around solely so WRONG_TAX_YEAR can
    # fire instead of degrading to a generic UNSUPPORTED_CITATION.
    applicable = [s for s in req.retrieved_spans if req.tax_year in s.tax_years]

    # --- Category-specific hallucination patterns ---
    profile = CATEGORY_PROFILE.get(req.category)
    a_lower = req.answer.lower()
    if profile:
        if profile["official_type"] == "credit" and re.search(r"\bdeduct", a_lower):
            flags.append("DEDUCTION_CREDIT_CONFUSION")
        elif profile["official_type"] == "deduction" and re.search(r"\bcredit", a_lower):
            flags.append("DEDUCTION_CREDIT_CONFUSION")

    # A definitive benefit claim must engage the threshold/condition for its category.
    if _is_definitive(req.answer):
        if profile and not any(t in a_lower for t in profile["threshold_terms"]):
            flags.append("MISSING_THRESHOLD")
        # ...and at least one applicable span must actually support the claim.
        if profile:
            claim_terms = profile["claim_terms"]
            supported = any(any(t in s.text.lower() for t in claim_terms) for s in applicable)
            if not supported:
                flags.append("CONCLUSION_EXCEEDS_SOURCE")
        elif not applicable:
            flags.append("CONCLUSION_EXCEEDS_SOURCE")

    # --- Every dollar/percent figure must appear in some applicable span ---
    for num in _extract_numbers(req.answer):
        if not any(num in s.text for s in applicable):
            flags.append("UNSUPPORTED_NUMBER")
            unsupported_numbers.append(num)

    # Deduplicate while preserving order.
    seen: set[str] = set()
    flags = [f for f in flags if not (f in seen or seen.add(f))]

    # --- Grounding verdict ---
    hard = {"UNSUPPORTED_CITATION", "WRONG_TAX_YEAR", "CONCLUSION_EXCEEDS_SOURCE"}
    if any(f in hard for f in flags):
        grounding, risk, review = "unsupported", "high", True
    elif flags:
        grounding, risk, review = "gaps", "high", True
    else:
        grounding, risk, review = "grounded", "medium", True  # grounded != filed; still review

    explanation = (
        f"Checked {len(req.citations)} citation(s) against "
        f"{len(req.retrieved_spans)} retrieved span(s) for tax year {req.tax_year}. "
        + (f"Flags: {', '.join(flags)}." if flags else "No hallucination patterns detected.")
    )

    return CitationCheckResult(
        grounding_status=grounding,
        flags=flags,
        verified_citations=verified,
        unsupported_numbers=unsupported_numbers,
        requires_review=review,
        risk_tier=risk,
        explanation=explanation,
    )
