import { useEffect, useRef, useState } from 'react'
import { verify } from '../api/client'
import { hljs } from '../lib/lean4-hljs'
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

/** Returns latency text and CSS class for color coding. */
function latencyDisplay(us: number): { text: string; cls: string } {
  const ms = us / 1000
  if (us < 10_000) return { text: `${ms.toFixed(1)}ms — kernel verified`, cls: 'latency-fast' }
  if (us >= 100_000) return { text: `${ms.toFixed(0)}ms — cold start`, cls: 'latency-slow' }
  return { text: `${ms.toFixed(1)}ms`, cls: 'latency-normal' }
}

/** Syntax-highlights a Lean 4 code block using the registered grammar. */
function HighlightedCode({ code }: { code: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (ref.current && code) {
      ref.current.removeAttribute('data-highlighted')
      ref.current.textContent = code
      hljs.highlightElement(ref.current)
    }
  }, [code])
  return (
    <pre className="conjecture-pre">
      <code ref={ref} className="language-lean4" />
    </pre>
  )
}

export function AgentPanel() {
  const [cards, setCards] = useState<CardState[]>([])
  const [running, setRunning] = useState(false)

  async function runAgent() {
    setRunning(true)
    setCards([])

    for (const scenario of SCENARIOS) {
      const id = `${Date.now()}-${Math.random()}`

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
      {/* Header: tool name + params */}
      <div className="agent-card-header">
        <span className="tool-name">{scenario.tool_name}</span>
        <span className="params-text">({formatParams(scenario.params as Record<string, unknown>)})</span>
      </div>

      {/* Verifying state */}
      {status === 'verifying' && (
        <div className="verifying-row">
          <span className="spinner" />
          <span className="verifying-text">→ verifying with Lean kernel…</span>
        </div>
      )}

      {/* Done state */}
      {status === 'done' && result && (
        <>
          {/* Conjecture box — shown when kernel returned a conjecture */}
          {result.conjecture && (
            <div className="conjecture-box">
              <div className="conjecture-label">Lean 4 conjecture</div>
              <HighlightedCode code={result.conjecture} />
            </div>
          )}

          {/* Verdict + latency (primary) + policy */}
          <div className="agent-card-result">
            <div className="result-row">
              <span className={`verdict-badge verdict-${result.verdict}`}>
                {result.verdict.toUpperCase()}
              </span>
              {result.latency_us > 0 && (() => {
                const { text, cls } = latencyDisplay(result.latency_us)
                return <span className={`latency-primary ${cls}`}>{text}</span>
              })()}
              <span className="policy-label">{result.policy_id}</span>
            </div>
            {result.verdict === 'blocked' && (
              <div className="explanation-text">{result.explanation}</div>
            )}
          </div>
        </>
      )}

      {status === 'done' && error && (
        <div className="error-text">Error: {error}</div>
      )}
    </div>
  )
}
