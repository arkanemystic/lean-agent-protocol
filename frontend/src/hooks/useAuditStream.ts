import { useCallback, useEffect, useRef, useState } from 'react'
import { getWsUrl } from '../api/client'
import type { AuditEntry } from '../types'

export type WsStatus = 'connecting' | 'connected' | 'disconnected'

const WS_BACKOFF_INITIAL = 3_000
const WS_BACKOFF_MAX    = 30_000

export function useAuditStream() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [status, setStatus] = useState<WsStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const retryDelayRef = useRef(WS_BACKOFF_INITIAL)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const url = getWsUrl('/ws/audit')
    setStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      retryDelayRef.current = WS_BACKOFF_INITIAL  // reset backoff on success
      setStatus('connected')
    }

    ws.onmessage = (ev) => {
      if (!mountedRef.current) return
      try {
        const entry = JSON.parse(ev.data as string) as AuditEntry
        setEntries((prev) => [entry, ...prev])
      } catch {
        // ignore malformed frames
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setStatus('disconnected')
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, WS_BACKOFF_MAX)
      retryRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const clearEntries = useCallback(() => setEntries([]), [])

  return { entries, status, clearEntries }
}
