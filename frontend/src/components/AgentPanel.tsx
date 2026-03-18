import { useState } from 'react'
import { verify } from '../api/client'
import type { GuardrailResultResponse } from '../types'

// Mirrors backend/app/agents/mock_trading.py _SCENARIOS exactly
const SCENARIOS = [
  { tool_name: 'place_order',        params: { symbol: 'AAPL', qty: 5000,  available_capital: 400000 }, agent_id: 'mock-trading-agent' },
  { tool_name: 'place_order',        params: { symbol: 'TSLA', qty: 50000, available_capital: 400000 }, agent_id: 'mock-trading-agent' },
  { tool_name: 'place_order',        params: { symbol: 'NVDA', qty: 8000,  available_capital: 400000 }, agent_id: 'mock-trading-agent' },
  { tool_name: 'place_order',        params: { symbol: 'MSFT', qty: 45000, available_capital: 400000 }, agent_id: 'mock-trading-agent' },
  { tool_name: 'rebalance_portfolio', params: { asset: 'SPY', new_weight: 0.22 }, agent_id: 'mock-trading-agent' },
  { tool_name: 'rebalance_portfolio', params: { asset: 'BTC', new_weight: 0.30 }, agent_id: 'mock-trading-agent' },
]

interface CardState {
  id: string
  scenario: (typeof SCENARIOS)[number]
  status: 'verifying' | 'done'
  result?: GuardrailResultResponse
  error?: string
}

function formatParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toLocaleString() : v}`)
    .join(', ')
}

function latencyLabel(us: number): string {
  if (us < 1000) return `${us}µs`
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`
  return `${(us / 1_000_000).toFixed(2)}s`
}

export function AgentPanel() {
  const [cards, setCards] = useState<CardState[]>([])
  const [running, setRunning] = useState(false)

  async function runAgent() {
    setRunning(true)
    setCards([])

    for (const scenario of SCENARIOS) {
      const id = `${Date.now()}-${Math.random()}`

      // Add a "verifying" card at the top
      setCards((prev) => [{ id, scenario, status: 'verifying' }, ...prev])

      try {
        const result = await verify(scenario)
        setCards((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: 'done', result } : c))
        )
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Request failed'
        setCards((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: 'done', error } : c))
        )
      }

      // 1.5s gap between scenarios
      await new Promise((r) => setTimeout(r, 1500))
    }

    setRunning(false)
  }

  function clear() {
    setCards([])
  }

  return (
    <div className="panel-content">
      <div className="agent-controls">
        <button className="btn btn-primary" onClick={runAgent} disabled={running}>
          {running ? <span className="spinner" /> : '▶'}
          {running ? ' Running…' : ' Run Agent'}
        </button>
        {cards.length > 0 && (
          <button className="btn btn-ghost" onClick={clear} disabled={running}>
            Clear
          </button>
        )}
      </div>

      {cards.length === 0 && !running && (
        <div className="agent-empty">
          Click <strong>Run Agent</strong> to cycle through 6 mock trading scenarios.
        </div>
      )}

      <div className="cards">
        {cards.map((card) => (
          <AgentCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  )
}

function AgentCard({ card }: { card: CardState }) {
  const { scenario, status, result, error } = card
  const verdict = result?.verdict

  return (
    <div
      className={`agent-card${verdict === 'allowed' ? ' card-allowed' : verdict === 'blocked' ? ' card-blocked' : ''}`}
    >
      <div className="agent-card-header">
        <span className="tool-name">{scenario.tool_name}</span>
        <span className="params-text">({formatParams(scenario.params as Record<string, unknown>)})</span>
      </div>

      {status === 'verifying' && (
        <div className="verifying-row">
          <span className="spinner" />
          <span className="verifying-text">→ verifying with Lean kernel…</span>
        </div>
      )}

      {status === 'done' && result && (
        <div className="agent-card-result">
          <div className="result-row">
            <span className={`verdict-badge verdict-${result.verdict}`}>
              {result.verdict.toUpperCase()}
            </span>
            <span className="latency-label">{latencyLabel(result.latency_us)}</span>
            <span className="policy-label">{result.policy_id}</span>
          </div>
          {result.verdict === 'blocked' && (
            <div className="explanation-text">{result.explanation}</div>
          )}
        </div>
      )}

      {status === 'done' && error && (
        <div className="error-text">Error: {error}</div>
      )}
    </div>
  )
}
