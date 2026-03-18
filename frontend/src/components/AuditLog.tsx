import { useRef, useState } from 'react'
import type { AuditEntry } from '../types'
import type { WsStatus } from '../hooks/useAuditStream'

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

function AuditCard({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const allowed = entry.verdict === 'allowed'

  return (
    <div
      className={`audit-card${allowed ? ' audit-allowed' : ' audit-blocked'}`}
    >
      {/* Top row */}
      <div className="audit-top">
        <span className="audit-ts">{formatTs(entry.timestamp)}</span>
        <span className="audit-agent">{entry.agent_id}</span>
        <span className={`verdict-badge verdict-${entry.verdict}`}>
          {entry.verdict.toUpperCase()}
        </span>
      </div>

      {/* Middle row: tool call */}
      <div className="audit-call">
        <span className="tool-name">{entry.tool_name}</span>
        <span className="params-text">{formatParams(entry.params)}</span>
      </div>

      {/* Bottom row: policy + explanation */}
      <div className="audit-bottom">
        <span className="policy-label">{entry.policy_id}</span>
        <span className="latency-label">{latencyLabel(entry.latency_us)}</span>
        <span className="audit-explanation">{entry.explanation}</span>
      </div>

      {/* Expandable Lean trace */}
      {entry.lean_trace && (
        <button
          className="trace-toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? '▲ Hide Lean trace' : '▼ Show Lean trace'}
        </button>
      )}
      {expanded && entry.lean_trace && (
        <pre className="lean-trace">{entry.lean_trace}</pre>
      )}
    </div>
  )
}

export function AuditLog({ entries, wsStatus }: Props) {
  const headerRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="audit-panel">
      <div className="audit-header" ref={headerRef}>
        <div className="audit-header-left">
          <span
            className={`ws-dot${connected ? ' pulse' : ''}`}
            style={{ background: connected ? 'var(--green)' : 'var(--muted)' }}
          />
          <span className="audit-title">Audit Log</span>
          {entries.length > 0 && (
            <span className="audit-count">{entries.length} events</span>
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
