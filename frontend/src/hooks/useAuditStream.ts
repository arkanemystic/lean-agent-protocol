import { useCallback, useEffect, useRef, useState } from 'react'
import { getWsUrl } from '../api/client'
import type { AuditEntry } from '../types'

export type WsStatus = 'connecting' | 'connected' | 'disconnected'

export function useAuditStream() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [status, setStatus] = useState<WsStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const url = getWsUrl()
    setStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
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
      // Reconnect after 3 seconds
      retryRef.current = setTimeout(connect, 3000)
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
