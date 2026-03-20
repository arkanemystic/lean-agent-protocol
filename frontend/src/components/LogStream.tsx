import { useEffect, useRef, useState } from 'react'

interface LogEntry {
  ts: string
  level: 'info' | 'success' | 'warn' | 'error'
  msg: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const SSE_BACKOFF_INITIAL = 3_000
const SSE_BACKOFF_MAX     = 30_000

export function LogStream() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(SSE_BACKOFF_INITIAL)

  function connect() {
    if (esRef.current) esRef.current.close()

    const url = `${API_BASE}/api/logs/stream`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      retryDelay.current = SSE_BACKOFF_INITIAL  // reset backoff on success
      setConnected(true)
    }

    es.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data)
        setEntries((prev) => {
          const next = [...prev, entry]
          // Keep last 200 entries
          return next.length > 200 ? next.slice(next.length - 200) : next
        })
      } catch {
        // ignore malformed
      }
    }

    es.onerror = () => {
      setConnected(false)
      es.close()
      esRef.current = null
      const delay = retryDelay.current
      retryDelay.current = Math.min(delay * 2, SSE_BACKOFF_MAX)
      reconnectTimer.current = setTimeout(connect, delay)
    }
  }

  useEffect(() => {
    connect()
    return () => {
      esRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return ''
    }
  }

  return (
    <div className="log-stream-panel">
      <div className="log-stream-header">
        <span className="log-stream-title">// system.log</span>
        <span className={`log-dot${connected ? ' log-dot-live' : ''}`} />
        {entries.length > 0 && (
          <button className="log-clear-btn" onClick={() => setEntries([])}>
            clear
          </button>
        )}
      </div>
      <div className="log-stream-body" ref={bodyRef}>
        <div className="log-static-header">
          AXIOM PROTOCOL — runtime telemetry — {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}
        </div>
        {entries.length === 0 ? (
          <div className="log-empty">{connected ? 'Waiting for events…' : 'Connecting…'}</div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`log-entry log-entry-${e.level}`}>
              <span className="log-ts">{formatTime(e.ts)}</span>
              <span className="log-msg">{e.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
