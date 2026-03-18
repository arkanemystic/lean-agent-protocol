import { useEffect, useRef, useState } from 'react'
import type { AuditEntry } from '../types'
import type { WsStatus } from '../hooks/useAuditStream'
import { hljs } from '../lib/lean4-hljs'

interface Props {
  entries: AuditEntry[]
  wsStatus: WsStatus
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

function latencyLabel(us: number): string {
  if (us < 1000) return `${us}µs`
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`
  return `${(us / 1_000_000).toFixed(2)}s`
}

function formatParams(params: Record<string, unknown>): string {
  return JSON.stringify(params, null, 0)
}

/** Parse the function name and args from a conjecture string.
 *  Input:  "import PolicyEnv.Basic\nexample : PolicyEnv.tradeWithinCapital 5000000 40000000 = true := by decide"
 *  Returns: { fnName: "tradeWithinCapital", args: ["5000000", "40000000"] }
 */
function parseConjecture(conjecture: string): { fnName: string; args: string[] } | null {
  const m = conjecture.match(/PolicyEnv\.(\w+)\s+((?:\d+\s*)+)=\s*true/)
  if (!m) return null
  return {
    fnName: m[1],
    args: m[2].trim().split(/\s+/),
  }
}

/** Syntax-highlights a Lean 4 block. */
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
    <pre className="conjecture-pre conjecture-pre-sm">
      <code ref={ref} className="language-lean4" />
    </pre>
  )
}

/** Structured verification breakdown parsed from conjecture + verdict. */
function TraceBreakdown({ entry }: { entry: AuditEntry }) {
  const [rawOpen, setRawOpen] = useState(false)
  const parsed = parseConjecture(entry.conjecture)

  return (
    <div className="trace-breakdown">
      {parsed ? (
        <div className="breakdown-table">
          <div className="breakdown-row">
            <span className="breakdown-key">function</span>
            <span className="breakdown-val mono">{parsed.fnName}</span>
          </div>
          <div className="breakdown-row">
            <span className="breakdown-key">arguments</span>
            <span className="breakdown-val mono">{parsed.args.join('  ')}</span>
          </div>
          <div className="breakdown-row">
            <span className="breakdown-key">conjecture</span>
            <span className="breakdown-val mono">= true</span>
          </div>
          <div className="breakdown-row">
            <span className="breakdown-key">result</span>
            <span className={`breakdown-val mono breakdown-result-${entry.verdict}`}>
              {entry.verdict === 'allowed'
                ? 'true → PROVED ✓'
                : entry.verdict === 'blocked'
                  ? 'false → REFUTED ✗'
                  : 'skipped'}
            </span>
          </div>
        </div>
      ) : (
        <div className="breakdown-unparsed mono">{entry.lean_trace || entry.conjecture}</div>
      )}

      {/* Raw output sub-toggle */}
      {entry.lean_trace && (
        <>
          <button className="trace-toggle raw-toggle" onClick={() => setRawOpen((o) => !o)}>
            {rawOpen ? '▲ Hide raw output' : '▼ Raw output'}
          </button>
          {rawOpen && <pre className="lean-trace">{entry.lean_trace}</pre>}
        </>
      )}
    </div>
  )
}

function AuditCard({ entry }: { entry: AuditEntry }) {
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [conjectureOpen, setConjectureOpen] = useState(false)
  const allowed = entry.verdict === 'allowed'
  const hasBreakdown = !!(entry.conjecture || entry.lean_trace)

  return (
    <div className={`audit-card${allowed ? ' audit-allowed' : ' audit-blocked'}`}>
      {/* Top row */}
      <div className="audit-top">
        <span className="audit-ts">{formatTs(entry.timestamp)}</span>
        <span className="audit-agent">{entry.agent_id}</span>
        <span className={`verdict-badge verdict-${entry.verdict}`}>
          {entry.verdict.toUpperCase()}
        </span>
      </div>

      {/* Tool call row */}
      <div className="audit-call">
        <span className="tool-name">{entry.tool_name}</span>
        <span className="params-text">{formatParams(entry.params)}</span>
      </div>

      {/* Bottom row: policy + latency (primary) + explanation */}
      <div className="audit-bottom">
        <span className="policy-label">{entry.policy_id}</span>
        {entry.latency_us > 0 && (
          <span className={`latency-primary ${entry.latency_us < 10_000 ? 'latency-fast' : entry.latency_us >= 100_000 ? 'latency-slow' : 'latency-normal'}`}>
            {latencyLabel(entry.latency_us)}
          </span>
        )}
        <span className="audit-explanation">{entry.explanation}</span>
      </div>

      {/* Verification breakdown toggle */}
      {hasBreakdown && (
        <button className="trace-toggle" onClick={() => setBreakdownOpen((o) => !o)}>
          {breakdownOpen ? '▲ Hide verification breakdown' : '▼ Verification breakdown'}
        </button>
      )}
      {breakdownOpen && <TraceBreakdown entry={entry} />}

      {/* Conjecture toggle */}
      {entry.conjecture && (
        <button className="trace-toggle" onClick={() => setConjectureOpen((o) => !o)}>
          {conjectureOpen ? '▲ Hide conjecture' : '▼ Lean 4 conjecture submitted to kernel'}
        </button>
      )}
      {conjectureOpen && entry.conjecture && (
        <div className="conjecture-box conjecture-box-sm">
          <HighlightedCode code={entry.conjecture} />
        </div>
      )}
    </div>
  )
}

export function AuditLog({ entries, wsStatus }: Props) {
  function exportJsonl() {
    const lines = entries.map((e) => JSON.stringify(e)).join('\n')
    const blob = new Blob([lines], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${Date.now()}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }

  const connected = wsStatus === 'connected'

  // Average latency over entries with non-zero latency
  const latencyEntries = entries.filter((e) => e.latency_us > 0)
  const avgLatencyMs = latencyEntries.length > 0
    ? latencyEntries.reduce((s, e) => s + e.latency_us, 0) / latencyEntries.length / 1000
    : null

  return (
    <div className="audit-panel">
      <div className="audit-header">
        <div className="audit-header-left">
          <span
            className={`ws-dot${connected ? ' pulse' : ''}`}
            style={{ background: connected ? 'var(--green)' : 'var(--muted)' }}
          />
          <span className="audit-title">Audit Log</span>
          {entries.length > 0 && (
            <span className="audit-count">{entries.length} events</span>
          )}
          {avgLatencyMs !== null && (
            <span className="audit-avg-latency">
              avg kernel latency: {avgLatencyMs.toFixed(1)}ms
            </span>
          )}
        </div>
        <div className="audit-header-right">
          <button
            className="btn btn-ghost btn-sm"
            onClick={exportJsonl}
            disabled={entries.length === 0}
          >
            Export JSONL
          </button>
        </div>
      </div>

      <div className="audit-feed">
        {entries.length === 0 && (
          <div className="audit-empty">
            {connected
              ? 'Waiting for events… Run the agent to see real-time verification.'
              : 'Connecting to audit stream…'}
          </div>
        )}
        {entries.map((entry) => (
          <AuditCard key={entry.call_id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
