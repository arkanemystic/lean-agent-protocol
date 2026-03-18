#!/usr/bin/env bash
# smoke-test.sh — Validate the deployed API endpoints.
#
# Usage:
#   ./smoke-test.sh
#   API_BASE=https://api.yourdomain.com ./smoke-test.sh

set -euo pipefail

API_BASE="${API_BASE:-https://api.YOURDOMAIN.com}"

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  local expected="$3"
  if [ "$result" = "$expected" ]; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label  (got: '$result', expected: '$expected')"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "Smoke testing: $API_BASE"
echo "─────────────────────────────────────────"

# ── Check 1: GET /api/health returns 200 ───────────────────────────────────
echo ""
echo "1. GET /api/health"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/health")
check "HTTP 200" "$HTTP_CODE" "200"

BACKEND_STATUS=$(curl -sf "${API_BASE}/api/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('backend','?'))" 2>/dev/null || echo "error")
check "backend=ok" "$BACKEND_STATUS" "ok"

WORKER_STATUS=$(curl -sf "${API_BASE}/api/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lean_worker'].get('status','?'))" 2>/dev/null || echo "error")
check "lean_worker=ok" "$WORKER_STATUS" "ok"

# ── Check 2: AAPL order → verdict=allowed ──────────────────────────────────
echo ""
echo "2. POST /api/verify — AAPL qty=5000 (expect: allowed)"
AAPL_VERDICT=$(curl -sf -X POST "${API_BASE}/api/verify" \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"place_order","params":{"symbol":"AAPL","qty":5000,"available_capital":400000},"agent_id":"smoke-test"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['verdict'])" 2>/dev/null || echo "error")
check "verdict=allowed" "$AAPL_VERDICT" "allowed"

# ── Check 3: TSLA order → verdict=blocked ──────────────────────────────────
echo ""
echo "3. POST /api/verify — TSLA qty=50000 (expect: blocked)"
TSLA_VERDICT=$(curl -sf -X POST "${API_BASE}/api/verify" \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"place_order","params":{"symbol":"TSLA","qty":50000,"available_capital":400000},"agent_id":"smoke-test"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['verdict'])" 2>/dev/null || echo "error")
check "verdict=blocked" "$TSLA_VERDICT" "blocked"

# ── Check 4: BTC rebalance → verdict=blocked ───────────────────────────────
echo ""
echo "4. POST /api/verify — BTC new_weight=0.30 (expect: blocked)"
BTC_VERDICT=$(curl -sf -X POST "${API_BASE}/api/verify" \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"rebalance_portfolio","params":{"asset":"BTC","new_weight":0.30},"agent_id":"smoke-test"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['verdict'])" 2>/dev/null || echo "error")
check "verdict=blocked" "$BTC_VERDICT" "blocked"

# ── Check 5: SPY rebalance → verdict=allowed ───────────────────────────────
echo ""
echo "5. POST /api/verify — SPY new_weight=0.22 (expect: allowed)"
SPY_VERDICT=$(curl -sf -X POST "${API_BASE}/api/verify" \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"rebalance_portfolio","params":{"asset":"SPY","new_weight":0.22},"agent_id":"smoke-test"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['verdict'])" 2>/dev/null || echo "error")
check "verdict=allowed" "$SPY_VERDICT" "allowed"

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
  echo "✓ All smoke tests passed"
  exit 0
else
  echo "✗ $FAIL test(s) failed"
  exit 1
fi
