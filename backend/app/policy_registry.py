"""
Policy registry: persists metadata for every compiled policy to a JSON file
on the shared Docker volume (policy_data/registry.json).

Each entry records:
  - which Lean function to call
  - which tool_names it applies to
  - how to extract and transform parameters from the ToolCall params dict
  - the Lean module to import

parameter_map:    {semantic_name: tool_param_key}
                  Ordered — arg order in the Lean function call matches dict order.
param_transforms: {semantic_name: transform}
                  Supported transforms:
                    "bps"  → int(float(value) * 10000)  (fraction → basis points)
                    "int"  → int(value)                  (default)
"""

import json
from pathlib import Path
from typing import Any

REGISTRY_PATH = Path("/app/policy_data/registry.json")

# Lean function signatures (verbatim from Basic.lean):
#   tradeWithinCapital  (tradeValue availableCapital : Nat) (maxBps := 1000)
#   positionWithinLimit (newWeightBps : Nat)                (limitBps := 2500)
#   priceWithinDeviation(execPrice refPrice : Nat)          (maxDeviationBps := 500)

DEFAULT_REGISTRY: dict[str, Any] = {
    "CAP-001": {
        "policy_id": "CAP-001",
        "display_name": "Capital Threshold",
        "lean_module": "PolicyEnv.Basic",
        "lean_function": "tradeWithinCapital",
        "applies_to_tools": ["place_order"],
        "parameter_map": {
            "trade_value": "qty",
            "capital": "available_capital",
        },
        "param_transforms": {},
        "description": "Trade value must not exceed 10% of available capital",
    },
    "PRC-001": {
        "policy_id": "PRC-001",
        "display_name": "Price Deviation",
        "lean_module": "PolicyEnv.Basic",
        "lean_function": "priceWithinDeviation",
        "applies_to_tools": ["place_order"],
        "parameter_map": {
            "price": "price",
            "reference_price": "reference_price",
        },
        "param_transforms": {},
        "description": "Execution price must not deviate more than 5% from reference",
    },
    "POS-001": {
        "policy_id": "POS-001",
        "display_name": "Position Limit",
        "lean_module": "PolicyEnv.Basic",
        "lean_function": "positionWithinLimit",
        "applies_to_tools": ["rebalance_portfolio"],
        "parameter_map": {
            "weight": "new_weight",
        },
        "param_transforms": {
            "weight": "bps",
        },
        "description": "Single asset position must not exceed 25% of portfolio",
    },
}


def _load_raw() -> dict[str, Any]:
    if not REGISTRY_PATH.exists():
        return {}
    try:
        return json.loads(REGISTRY_PATH.read_text())  # type: ignore[return-value]
    except (json.JSONDecodeError, OSError):
        return {}


def load_registry() -> dict[str, Any]:
    """Return the full registry dict. Falls back to DEFAULT_REGISTRY if file is absent."""
    data = _load_raw()
    return data if data else dict(DEFAULT_REGISTRY)


def save_registry(registry: dict[str, Any]) -> None:
    """Persist the registry to disk, creating the directory if needed."""
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2))


def get_policies_for_tool(tool_name: str) -> list[dict[str, Any]]:
    """Return all policy entries whose applies_to_tools list includes tool_name."""
    registry = load_registry()
    return [
        p for p in registry.values()
        if tool_name in p.get("applies_to_tools", [])
    ]


def register_policy(metadata: dict[str, Any]) -> None:
    """Add or overwrite a policy entry, then persist."""
    registry = load_registry()
    registry[metadata["policy_id"]] = metadata
    save_registry(registry)


def seed_if_missing() -> None:
    """Write the default registry on first run (file absent or empty)."""
    if not REGISTRY_PATH.exists() or not _load_raw():
        REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
        save_registry(DEFAULT_REGISTRY)
        print(
            f"policy_registry: seeded {len(DEFAULT_REGISTRY)} default policies "
            f"→ {REGISTRY_PATH}",
            flush=True,
        )
