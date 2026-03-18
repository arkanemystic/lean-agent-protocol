import { useEffect, useState } from 'react'
import { getHealth } from '../api/client'
import type { HealthResponse } from '../types'

export function StatusPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchHealth() {
    try {
      const data = await getHealth()
      setHealth(data)
      setLastFetch(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 10_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="panel-content">
      <div className="status-header">
        <span className="section-label">System Status</span>
        {lastFetch && (
          <span className="muted-text">
            updated {lastFetch.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div className="error-text">⚠ {error}</div>}

      {health && (
        <div className="status-grid">
          <StatusRow
            label="Backend API"
            value={health.backend}
            ok={health.backend === 'ok'}
          />
          <StatusRow
            label="Lean Worker"
            value={health.lean_worker.status}
            ok={health.lean_worker.status === 'ok'}
          />
          <StatusRow
            label="Policies Loaded"
            value={String(health.lean_worker.policies_loaded ?? '—')}
            ok={true}
          />
        </div>
      )}

      {!health && !error && (
        <div className="status-loading">
          <span className="spinner" /> Checking services…
        </div>
      )}

      <div className="status-info">
        <div className="info-row">
          <span className="info-label">Architecture</span>
          <span className="info-value muted-text">FastAPI → Lean 4 kernel (HTTP)</span>
        </div>
        <div className="info-row">
          <span className="info-label">Verification</span>
          <span className="info-value muted-text">Nat basis-point arithmetic, decidable</span>
        </div>
        <div className="info-row">
          <span className="info-label">Audit</span>
          <span className="info-value muted-text">Append-only JSONL, WebSocket stream</span>
        </div>
      </div>
    </div>
  )
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok: boolean
}) {
  return (
    <div className="status-row">
      <span className="status-label">{label}</span>
      <span className={`status-value ${ok ? 'status-ok' : 'status-err'}`}>
        <span className="status-dot" />
        {value}
      </span>
    </div>
  )
}
