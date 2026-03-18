"""
Builds Lean 4 conjectures dynamically from the policy registry and calls the lean-worker.

Conjecture shape for a policy entry:
  import {lean_module}
  example : PolicyEnv.{lean_function} {arg0} {arg1} ... = true := by decide

Args are extracted from the ToolCall params dict using parameter_map (ordered) and
converted via param_transforms:
  "bps"  → int(float(value) * 10000)   e.g. new_weight=0.22 → 2200
  "int"  → int(value)                   default for all other params

A tool call is ALLOWED only if every applicable policy proves.
If a policy's required params are absent from the tool call, that policy is skipped.
If no policy covers the tool, the result is "skipped".
"""

from typing import Any

import httpx

from .policy_registry import get_policies_for_tool


def _apply_transform(value: Any, transform: str) -> int:
    if transform == "bps":
        return int(float(value) * 10000)
    return int(value)


def build_conjecture_for_policy(policy: dict[str, Any], params: dict[str, Any]) -> str:
    """
    Build a single Lean conjecture string for one policy applied to given params.
    Raises KeyError if a required param is absent from params.
    Raises ValueError if a param value cannot be coerced to int.
    """
    param_map: dict[str, str] = policy["parameter_map"]      # semantic → tool key
    transforms: dict[str, str] = policy.get("param_transforms", {})
    lean_module: str = policy["lean_module"]
    lean_function: str = policy["lean_function"]

    args: list[str] = []
    for semantic_name, tool_key in param_map.items():
        raw = params[tool_key]                                 # KeyError → caller skips
        transform = transforms.get(semantic_name, "int")
        args.append(str(_apply_transform(raw, transform)))

    return (
        f"import {lean_module}\n"
        f"example : PolicyEnv.{lean_function} {' '.join(args)} = true := by decide"
    )


async def verify(
    tool_name: str,
    params: dict[str, Any],
    lean_worker_url: str,
) -> dict[str, Any]:
    """
    Check ALL applicable policies for a tool call.

    Returns a dict compatible with the shape main.py expects:
      result    : "proved" | "refuted" | "error" | "skipped"
      trace     : Lean kernel output (empty string when proved/skipped)
      latency_us: cumulative µs across all policy checks
      policy_id : policy that proved/refuted/errored, or comma-joined list when proved
    """
    policies = get_policies_for_tool(tool_name)

    if not policies:
        return {
            "result": "skipped",
            "trace": "",
            "latency_us": 0,
            "policy_id": "NONE",
            "conjecture": "",
        }

    total_latency: int = 0
    proved_ids: list[str] = []
    last_conjecture: str = ""

    async with httpx.AsyncClient(timeout=35.0) as client:
        for policy in policies:
            try:
                conjecture = build_conjecture_for_policy(policy, params)
            except (KeyError, ValueError):
                # Required params absent or unconvertible — skip this policy
                continue

            last_conjecture = conjecture

            resp = await client.post(
                f"{lean_worker_url}/verify",
                json={"conjecture": conjecture, "params": params},
            )
            resp.raise_for_status()
            worker_resp = resp.json()

            total_latency += worker_resp.get("latency_us", 0)
            lean_result: str = worker_resp["result"]

            if lean_result in ("refuted", "error"):
                # Fail fast: return the first failing policy
                return {
                    "result": lean_result,
                    "trace": worker_resp.get("trace", ""),
                    "latency_us": total_latency,
                    "policy_id": policy["policy_id"],
                    "conjecture": conjecture,
                }

            proved_ids.append(policy["policy_id"])

    if not proved_ids:
        # Every applicable policy was skipped (missing params)
        return {
            "result": "skipped",
            "trace": "",
            "latency_us": 0,
            "policy_id": "NONE",
            "conjecture": "",
        }

    return {
        "result": "proved",
        "trace": "",
        "latency_us": total_latency,
        "policy_id": ", ".join(proved_ids),
        "conjecture": last_conjecture,
    }


async def compile_policy(
    lean_code: str,
    policy_id: str,
    lean_worker_url: str,
) -> dict[str, Any]:
    """Forward a policy compilation request to the lean-worker."""
    async with httpx.AsyncClient(timeout=130.0) as client:
        resp = await client.post(
            f"{lean_worker_url}/compile-policy",
            json={"lean_code": lean_code, "policy_id": policy_id},
        )
        resp.raise_for_status()
        return resp.json()  # type: ignore[return-value]
