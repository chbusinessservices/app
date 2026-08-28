"""Pydantic models for tax-position claims and deterministic validation results.

Aligned with the TaxDeductionClaim JSON schema in the product design spec.
Keeps observed facts (ocr/user/imported) separate from inferred facts so the
model can never quietly promote an inference into an eligibility conclusion.
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum


class FactOrigin(str, Enum):
    ocr = "ocr"
    user = "user"
    imported = "imported"
    inferred = "inferred"
    reviewed = "reviewed"


class SourceFact(BaseModel):
    field: str
    value: Any
    origin: FactOrigin
    confidence: float = Field(ge=0.0, le=1.0)
    document_id: Optional[str] = None
    page: Optional[int] = None


class Jurisdiction(BaseModel):
    country: str = "US"
    state: Optional[str] = None
    locality: Optional[str] = None


class RuleRef(BaseModel):
    source: str
    revision: str
    page_or_section: Optional[str] = None
    hash: Optional[str] = None


class ViolationStatus(str, Enum):
    supported = "supported"
    potentially_supported = "potentially_supported"
    unsupported = "unsupported"
    contradicted = "contradicted"
    outdated = "outdated"
    human_review_required = "human_review_required"


class RiskTier(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Calculation(BaseModel):
    agi: Optional[str] = None
    qualified_paid: Optional[str] = None
    reimbursements: Optional[str] = None
    net_qualified_expense: Optional[str] = None
    threshold_rate: Optional[str] = None
    threshold_amount: Optional[str] = None
    potentially_deductible: Optional[str] = None
    line_mapping: Optional[Dict[str, str]] = None


class MedicalValidationResult(BaseModel):
    claim_id: str
    tax_year: int
    jurisdiction: Jurisdiction
    category: str = "medical_dental"
    form: str = "Schedule A (Form 1040)"
    status: ViolationStatus
    risk_tier: RiskTier
    flags: List[str] = []
    calculation: Calculation
    source_status: str  # current_approved | outdated | unavailable
    rule_ref: Optional[RuleRef] = None
    missing_facts: List[str] = []
    audit_event_id: Optional[str] = None
    filing_blocked: bool = True
    review_required: bool = True
    disclaimer: str = (
        "Deterministic calculation only. Not a filing decision and not an "
        "eligibility determination. A qualified reviewer must approve before "
        "any return field is populated."
    )


class MedicalClaimRequest(BaseModel):
    """Inputs the client/LLM sends to the Pub. 502 validator."""
    claim_id: Optional[str] = None
    tax_year: int = Field(ge=2000)
    jurisdiction: Jurisdiction = Jurisdiction()
    # Taxpayer facts (observed, not inferred) — caller must supply these.
    agi: float
    paid_medical: float
    reimbursements: float = 0.0
    itemizing: bool
    qualified_expense: bool
    paid_in_tax_year: bool
    # Optional: the rate the proposing model assumed. If it differs from the
    # approved tax-year rate, the validator flags a mismatch (never trusts it).
    threshold_rate: Optional[float] = None
    source_facts: List[SourceFact] = []
    rule_ref: Optional[RuleRef] = None
