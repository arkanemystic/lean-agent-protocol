"""
Translates a failed Lean proof trace into a plain-language explanation
using the Claude API (claude-sonnet-4-6).
"""

import os
from typing import Any

import anthropic

SYSTEM_PROMPT = (
    "You are a compliance explanation engine for a formal verification system. "
    "You receive a failed Lean 4 proof trace and the original action parameters. "
    "Produce a single, clear sentence explaining why the action was blocked, "
    "citing the specific policy constraint that was violated and the exact values involved. "
    "Be precise. Do not hedge. "
    "Format: 'Blocked: [reason citing specific values and policy].'")


def translate(lean_trace: str, action_params: dict[str, Any], policy_id: str) -> str:
    """
    Call Claude to explain why a Lean verification failed.
    Returns a plain-language sentence, or a fallback if the API key is missing.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _fallback_explanation(action_params, policy_id)

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=200,
            system=SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": (
                    f"Policy: {policy_id}\n"
                    f"Params: {action_params}\n"
                    f"Lean trace: {lean_trace}"
                ),
            }],
        )
        return response.content[0].text
    except Exception as exc:
        return _fallback_explanation(action_params, policy_id, str(exc))


def _fallback_explanation(
    params: dict[str, Any],
    policy_id: str,
    reason: str = "",
) -> str:
    """Produce a rule-based explanation when the Claude API is unavailable."""
    if policy_id == "CAP-001":
        trade_value = params.get("qty", "?")
        capital = params.get("available_capital", "?")
        try:
            pct = round(int(trade_value) / int(capital) * 100, 2)
            return (
                f"Blocked: trade value ${trade_value:,} represents {pct}% of available "
                f"capital ${capital:,}, exceeding the 10% limit defined in Policy CAP-001."
            )
        except Exception:
            pass
    if policy_id == "POS-001":
        weight = params.get("new_weight", "?")
        try:
            pct = round(float(weight) * 100, 2)
            return (
                f"Blocked: proposed position weight of {pct}% exceeds the 25% "
                f"single-asset limit defined in Policy POS-001."
            )
        except Exception:
            pass
    return f"Blocked: action violates {policy_id} constraints. {reason}".strip()
