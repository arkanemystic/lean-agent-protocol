"""
MockTradingAgent: cycles through 6 pre-programmed scenarios (alternating pass/fail).

Scenario verification against Lean thresholds:
  CAP-001: cap001Compliant(tradeValue, availableCapital)
           → tradeValue * 10000 ≤ availableCapital * 1000
           → simplified: tradeValue * 10 ≤ availableCapital

  POS-001: pos001Compliant(newWeightBps)
           → newWeightBps ≤ 2500

  #1 place_order  AAPL qty=5000  cap=400000: 5000*10=50000 ≤ 400000  ✅ allowed
  #2 place_order  TSLA qty=50000 cap=400000: 50000*10=500000 > 400000 ❌ blocked
  #3 place_order  NVDA qty=8000  cap=400000: 8000*10=80000 ≤ 400000  ✅ allowed
  #4 place_order  MSFT qty=45000 cap=400000: 45000*10=450000 > 400000 ❌ blocked
  #5 rebalance    SPY  weight=0.22 → 2200 bps ≤ 2500               ✅ allowed
  #6 rebalance    BTC  weight=0.30 → 3000 bps > 2500               ❌ blocked
"""

import itertools
from .base import BaseAgent, ToolCall, GuardrailResult

_SCENARIOS = [
    ToolCall(
        tool_name="place_order",
        params={"symbol": "AAPL", "qty": 5000, "available_capital": 400000},
        agent_id="mock-trading-agent",
    ),
    ToolCall(
        tool_name="place_order",
        params={"symbol": "TSLA", "qty": 50000, "available_capital": 400000},
        agent_id="mock-trading-agent",
    ),
    ToolCall(
        tool_name="place_order",
        params={"symbol": "NVDA", "qty": 8000, "available_capital": 400000},
        agent_id="mock-trading-agent",
    ),
    ToolCall(
        tool_name="place_order",
        params={"symbol": "MSFT", "qty": 45000, "available_capital": 400000},
        agent_id="mock-trading-agent",
    ),
    ToolCall(
        tool_name="rebalance_portfolio",
        params={"asset": "SPY", "new_weight": 0.22},
        agent_id="mock-trading-agent",
    ),
    ToolCall(
        tool_name="rebalance_portfolio",
        params={"asset": "BTC", "new_weight": 0.30},
        agent_id="mock-trading-agent",
    ),
]


class MockTradingAgent(BaseAgent):
    def __init__(self) -> None:
        self._cycle = itertools.cycle(_SCENARIOS)
        self._last_result: GuardrailResult | None = None

    def get_pending_action(self) -> ToolCall:
        """Return the next scenario (cycles indefinitely)."""
        scenario = next(self._cycle)
        # Return a fresh ToolCall so each invocation gets a new call_id
        return ToolCall(
            tool_name=scenario.tool_name,
            params=dict(scenario.params),
            agent_id=scenario.agent_id,
        )

    def receive_result(self, result: GuardrailResult) -> None:
        self._last_result = result
