"""Multi-state logic: layered federal <-> state rule objects.

Federal logic is the base layer; a state may conform, partially conform, or
override. Retrieval is scoped by state + tax year + category so a state-specific
override never silently applies to the wrong state. This is the foundation for
the spec's "Layered approach: federal logic, state-specific logic" — the medical
validator stays the federal base; this layer adds state treatment on top.

State data here is illustrative of the architecture (conformity + override +
notes), not exhaustive tax law. Each state rule object carries its tax-year
coverage and a conformity status so the caller can tell whether a federal
conclusion also holds for the state.
"""
from typing import Optional, List

STATE_RULES = {
    "CA": {
        "name": "California",
        "conformity": "conforms",
        "tax_years": [2023, 2024, 2025],
        "categories": {
            "medical_dental": {
                "floor": "7.5%",
                "follows_federal": True,
                "notes": "California conforms to the federal 7.5% medical AGI floor.",
            },
        },
    },
    "NY": {
        "name": "New York",
        "conformity": "conforms",
        "tax_years": [2023, 2024, 2025],
        "categories": {
            "medical_dental": {
                "floor": "7.5%",
                "follows_federal": True,
                "notes": "New York conforms to the federal medical AGI floor.",
            },
        },
    },
    "OR": {
        "name": "Oregon",
        "conformity": "partial",
        "tax_years": [2023, 2024, 2025],
        "categories": {
            "medical_dental": {
                "floor": "7.5%",
                "follows_federal": True,
                "notes": "Oregon conforms to the federal floor; seniors may also "
                         "use a separate medical subtraction — see OR instructions.",
            },
        },
    },
}


def get_state_rule(state: str, tax_year: int, category: str = "medical_dental") -> Optional[dict]:
    st = STATE_RULES.get((state or "").upper())
    if not st or tax_year not in st["tax_years"]:
        return None
    cat = st["categories"].get(category)
    if not cat:
        return None
    return {
        "state": (state or "").upper(),
        "state_name": st["name"],
        "conformity": st["conformity"],
        "tax_year": tax_year,
        "category": category,
        **cat,
    }


def layered_assess(federal_result: dict, state: str, tax_year: int) -> dict:
    """Merge a federal validation result with the state rule for the same
    category/year. If the state conforms, the federal conclusion holds; a
    partial/override state adds a caveat the reviewer must clear."""
    category = federal_result.get("category", "medical_dental")
    state_rule = get_state_rule(state, tax_year, category)
    if not state_rule:
        return {
            "federal": federal_result,
            "state": None,
            "state_status": "no_rule",
            "effective_status": federal_result.get("status"),
            "note": f"No state rule for {state} / {tax_year} / {category}. "
                    "Do not file a state position without verified state authority.",
        }
    follows = state_rule["follows_federal"]
    return {
        "federal": federal_result,
        "state": state_rule,
        "state_status": "conforms" if follows else "override",
        "effective_status": federal_result.get("status") if follows else "needs_state_review",
        "note": (
            f"{state_rule['state_name']} conforms to the federal result."
            if follows else
            f"{state_rule['state_name']} does NOT fully conform; clear the state "
            f"caveat before any state return-field update: {state_rule['notes']}"
        ),
    }


def state_registry_view() -> List[dict]:
    return [
        {
            "state": code,
            "name": st["name"],
            "conformity": st["conformity"],
            "tax_years": st["tax_years"],
            "categories": list(st["categories"].keys()),
        }
        for code, st in STATE_RULES.items()
    ]
