"""TaxPilot deterministic tax-position validation.

The LLM may propose a deduction, but a versioned rule engine (not the model)
decides whether the facts and authority support it.

Core release rule: no authoritative source, no definitive answer; no verified
facts, no deduction eligibility; no required human approval, no return-field
update or filing action.
"""
