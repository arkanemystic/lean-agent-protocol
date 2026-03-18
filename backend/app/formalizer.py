"""
Two-step NL → Lean 4 pipeline.

Step 1: Claude API generates a Lean 4 theorem skeleton with 'sorry' placeholders.
Step 2: Aristotle fills the sorry and returns verified Lean 4.
"""

import json
import os
import re
from typing import Any

SKELETON_SYSTEM = (
    "You are a Lean 4 code generator for financial policy axioms. "
    "Convert this financial policy into a Lean 4 theorem skeleton. "
    "Use Nat arithmetic with basis points (multiply dollar amounts by 100). "
    "Use sorry as a placeholder for the proof body. "
    "Output ONLY valid Lean 4 code, no prose, no markdown. "
    "Import PolicyEnv at the top. "
    "Follow this exact pattern:\n\n"
    "import PolicyEnv\n\n"
    "/-- [original policy in English] --/\n"
    "theorem [camelCaseName] ([params] : Nat) :\n"
    "    [constraint expressed as Nat inequality] := by\n"
    "  sorry\n\n"
    "Example for 'trade value must not exceed 10% of capital':\n"
    "import PolicyEnv\n\n"
    "/-- Trade value must not exceed 10% of available capital --/\n"
    "theorem tradeCapitalCompliant (trade_value capital : Nat) :\n"
    "    trade_value * 10 ≤ capital := by\n"
    "  sorry"
)

EXTRACT_SYSTEM = (
    "You are a financial policy extraction engine. Extract every "
    "distinct, enforceable financial rule from this document. Each "
    "rule must be atomic (one constraint) and expressible as a "
    "mathematical inequality. Return ONLY a JSON array of strings. "
    "No preamble, no explanation, no markdown."
)


def _auto_policy_id() -> str:
    """Generate the next available POL-XXX id by inspecting the live registry."""
    from .policy_registry import load_registry
    registry = load_registry()
    nums = []
    for k in registry.keys():
        m = re.match(r"POL-(\d+)", k)
        if m:
            nums.append(int(m.group(1)))
    return f"POL-{(max(nums, default=0) + 1):03d}"


async def _generate_skeleton(statement: str) -> str:
    """Call Claude to produce a Lean 4 skeleton with sorry placeholders."""
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is not set")
    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SKELETON_SYSTEM,
        messages=[{"role": "user", "content": statement}],
    )
    return response.content[0].text.strip()


async def formalize(statement: str) -> dict[str, Any]:
    """
    Full two-step pipeline: NL statement → Aristotle-verified Lean 4.
    Returns a dict matching the FormalizePolicyResponse schema.
    """
    policy_id = _auto_policy_id()

    # Step 1: Claude skeleton
    try:
        skeleton = await _generate_skeleton(statement)
    except Exception as exc:
        return {
            "statement": statement,
            "skeleton": "",
            "lean_code": None,
            "status": "failed",
            "error": f"Skeleton generation failed: {exc}",
            "policy_id": policy_id,
        }

    # Step 2: Aristotle verification
    try:
        import aristotlelib  # type: ignore[import]
        project = await aristotlelib.Project.create(prompt=skeleton)
        result = await project.wait_for_completion()
        return {
            "statement": statement,
            "skeleton": skeleton,
            "lean_code": result,
            "status": "success",
            "error": None,
            "policy_id": policy_id,
        }
    except Exception as exc:
        return {
            "statement": statement,
            "skeleton": skeleton,
            "lean_code": None,
            "status": "failed",
            "error": f"Aristotle verification failed: {exc}",
            "policy_id": policy_id,
        }


async def extract_policy_statements(text: str) -> list[str]:
    """Call Claude to extract atomic policy statements from document text."""
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is not set")
    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=EXTRACT_SYSTEM,
        messages=[{"role": "user", "content": text[:20_000]}],
    )
    raw = response.content[0].text.strip()
    # Strip markdown code fences if Claude adds them
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)
