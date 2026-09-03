"""Versioned IRS source registry + rule-aware retrieval.

Provides the approved, tax-year-scoped source spans that ground LLM answers.
Retrieval is keyword-scored for now (a deterministic stand-in); the interface
(`retrieve(query, tax_year, category) -> List[SourceSpan]`) is what the citation
detector consumes, so a vector/BM25 backend can drop in later without changing
callers. Spans are versioned (revision + hash + tax_years) so a prior-year
question never silently pulls a current-year rule.
"""
from typing import List, Optional
import re
from .citation_check import SourceSpan

# Each span is a chunk of an approved publication carrying its tax-year coverage
# and content hash so the citation detector can verify year + provenance.
SOURCE_SPANS: List[SourceSpan] = [
    SourceSpan(
        source_id="pub-502-floor",
        publication="Publication 502",
        revision="2024",
        tax_years=[2023, 2024, 2025],
        page_or_section="How to Figure Your Deduction",
        hash="sha256:2b4c8f19a0e73c88",
        text=(
            "You can deduct only the amount of your medical and dental expenses "
            "that is more than 7.5% of your adjusted gross income (AGI). This is "
            "the threshold for medical expense deductions on Schedule A. The "
            "7.5% AGI floor applies. You must itemize deductions on Schedule A "
            "(Form 1040) to claim medical and dental expenses."
        ),
    ),
    SourceSpan(
        source_id="pub-502-reimb",
        publication="Publication 502",
        revision="2024",
        tax_years=[2023, 2024, 2025],
        page_or_section="Reimbursements",
        hash="sha256:2b4c8f19a0e73c88",
        text=(
            "You must reduce your total medical expenses for the year by any "
            "reimbursements. You can include only the medical and dental expenses "
            "you paid during the tax year. Reimbursed amounts are not deductible."
        ),
    ),
    SourceSpan(
        source_id="pub-502-nonqual",
        publication="Publication 502",
        revision="2024",
        tax_years=[2023, 2024, 2025],
        page_or_section="What Expenses Are Not Deductible",
        hash="sha256:2b4c8f19a0e73c88",
        text=(
            "You cannot deduct cosmetic surgery, nonprescription drugs, or "
            "expenses that are merely beneficial to your general health. Only "
            "qualified medical expenses paid for the diagnosis, cure, mitigation, "
            "treatment, or prevention of disease are deductible."
        ),
    ),
    SourceSpan(
        source_id="pub-970-sloa",
        publication="Publication 970",
        revision="2024",
        tax_years=[2023, 2024, 2025],
        page_or_section="Student Loan Interest Deduction",
        hash="sha256:9c3d8f2a71b5e04c",
        text=(
            "You can deduct student loan interest up to $2,500 as an adjustment to "
            "income, even if you do not itemize. The deduction is phased out "
            "based on your modified AGI. The $2,500 cap applies."
        ),
    ),
    SourceSpan(
        source_id="pub-587-office",
        publication="Publication 587",
        revision="2024",
        tax_years=[2023, 2024, 2025],
        page_or_section="Business Use of Your Home",
        hash="sha256:6a19b7c3e2f04dd1",
        text=(
            "To claim a home office deduction, you must use part of your home "
            "exclusively and regularly as your principal place of business. The "
            "exclusive and regular business use requirement applies."
        ),
    ),
    SourceSpan(
        source_id="form-8880-savers",
        publication="Form 8880 Instructions",
        revision="2024",
        tax_years=[2024, 2025],
        page_or_section="Credit for Qualified Retirement Savings Contributions",
        hash="sha256:c04f2b8a19e7f341",
        text=(
            "The Retirement Savings Contributions Credit (Saver's Credit) is a "
            "nonrefundable credit for eligible taxpayers. Income limits and AGI "
            "phaseouts apply. This is a credit, not a deduction."
        ),
    ),
]

# Map category -> span source_ids that are authoritative for it, so retrieval
# biases toward the right publication when a category is known.
CATEGORY_SPANS = {
    "medical_dental": ["pub-502-floor", "pub-502-reimb", "pub-502-nonqual"],
    "student_loan_int": ["pub-970-sloa"],
    "home_office": ["pub-587-office"],
    "retirement_savers": ["form-8880-savers"],
}

_STOP = set("the a an of to in on for and or you your is are can may this that with".split())


def _score(span: SourceSpan, terms: List[str]) -> int:
    text = span.text.lower()
    return sum(text.count(t) for t in terms)


def retrieve(query: str, tax_year: int, category: Optional[str] = None, top_k: int = 5) -> List[SourceSpan]:
    """Return up to top_k approved spans for the query.

    Year-ineligible spans are NOT dropped: keeping them lets the citation
    detector surface WRONG_TAX_YEAR instead of a generic UNSUPPORTED_CITATION.
    Grounding (in the detector) only counts spans whose tax_years include the
    requested year, so a prior-year answer is never actually grounded by a
    current-only rule — it just produces a year-mismatch flag. Category-known
    authoritative spans are boosted; within each group, year-valid spans rank
    first, then by keyword score.
    """
    terms = [w for w in re.findall(r"[a-z0-9%]+", (query or "").lower()) if w not in _STOP and len(w) > 2]

    cat_ids = set(CATEGORY_SPANS.get(category, []))
    cat_spans = [s for s in SOURCE_SPANS if s.source_id in cat_ids]
    other_spans = [s for s in SOURCE_SPANS if s.source_id not in cat_ids]

    # year-valid first (False sorts before True), then highest keyword score.
    cat_spans.sort(key=lambda s: (tax_year not in s.tax_years, -_score(s, terms), s.source_id))
    other_spans.sort(key=lambda s: (tax_year not in s.tax_years, -_score(s, terms), s.source_id))

    return (cat_spans + other_spans)[:top_k]


def registry_view() -> List[dict]:
    """Public metadata for each span (no body text) for the sources endpoint."""
    return [
        {
            "source_id": s.source_id,
            "publication": s.publication,
            "revision": s.revision,
            "tax_years": s.tax_years,
            "page_or_section": s.page_or_section,
            "hash": s.hash,
            "text_preview": s.text[:80] + "...",
        }
        for s in SOURCE_SPANS
    ]
