# TaxPilot Agent Selection Cheat Sheet

Use this quick guide to choose the right agent for the job.

## 1) TaxPilot Compliance Validator
Best for: broad tax-AI governance, product boundaries, source-grounding, and safe design review.

Choose this when:
- you need to review whether a tax feature is safe and defensible
- the task is policy, architecture, or source-grounding related
- you need to distinguish deductions from credits, federal from state, or current-year from superseded authority
- you want a conservative, compliance-first recommendation

Short prompt template:
> Review this TaxPilot workflow for tax-law grounding, source-versioning, human-review gates, and safe product boundaries. Identify any unsupported claims, missing authority, or high-risk decisions.

---

## 2) TaxPilot QA Regression Agent
Best for: reproducible bugs, regression testing, and API/workflow verification.

Choose this when:
- you need to reproduce a failing behavior
- you want to verify a fix with real evidence
- the issue is in backend/frontend workflow contracts or app behavior
- you need to isolate root cause before changing code

Short prompt template:
> Reproduce the issue in the smallest relevant workflow, identify the root cause, and verify the fix with the smallest meaningful test or command.

---

## 3) TaxPilot Medical Deduction Validator
Best for: medical and dental deduction review, documentation review, and review gating.

Choose this when:
- the question is about a medical deduction claim
- you need to evaluate reimbursed vs. unreimbursed amounts
- you want to check AGI thresholds, HSA/FSA/HRA treatment, or cross-year reimbursements
- the issue needs evidence and escalation instead of a definitive answer

Short prompt template:
> Audit this medical-expense claim for 2025 Schedule A support, AGI-floor logic, reimbursements, HSA/FSA/HRA treatment, documentation gaps, and whether human review is required.

---

## 4) TaxPilot Security Compliance Reviewer
Best for: app/API guardrails, auth, access control, and sensitive-tax-data protection.

Choose this when:
- the task is security or compliance review
- you need to check bearer tokens, taxpayer scoping, consent, uploads, or chat safety
- you are reviewing export, filing, or review gating controls
- you want a strict fail-closed evaluation

Short prompt template:
> Review this TaxPilot app/API workflow for auth, authorization, consent, upload validation, review gating, and sensitive-data handling. Identify any bypass, unsafe default, or compliance risk.

---

## 5) TaxPilot 2025 Medical Deduction Simulator
Best for: exact 2025 medical-expense calculation and tracker design.

Choose this when:
- you want the actual Schedule A medical calculation
- you need to model 2025 AGI threshold logic and reimbursement subtraction
- you need a tracker for medical-expense records or a calculation workflow
- you want a structured, deterministic medical deduction model

Short prompt template:
> Calculate the 2025 federal medical deduction using the approved AGI threshold, subtract reimbursements and HSA/FSA/HRA offsets, and flag any unsupported, duplicate, or unresolved expense records.

---

## Quick decision rule
- Policy / design review → TaxPilot Compliance Validator
- Bug reproduction / regression proof → TaxPilot QA Regression Agent
- Medical deduction review → TaxPilot Medical Deduction Validator
- Security / API guardrail review → TaxPilot Security Compliance Reviewer
- Exact 2025 medical calculation → TaxPilot 2025 Medical Deduction Simulator

## Default rule
If the task is broad, policy-heavy, or cross-cutting, start with the Compliance Validator. If it is a specific workflow failure, start with the QA Regression Agent. If it is a specific medical-expense claim, use the medical specialist. If it is about access or unsafe behavior, use the Security reviewer. If it is about exact numbers, use the simulator.
