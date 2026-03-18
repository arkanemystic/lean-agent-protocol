/// <reference types="vite/client" />
import type {
  CompilePolicyRequest,
  CompilePolicyResponse,
  GuardrailResultResponse,
  HealthResponse,
  ToolCallRequest,
  AuditEntry,
} from '../types'

// In dev, Vite proxies /api → http://localhost:8000/api
// In production, VITE_API_URL is the full backend URL
const API_BASE =
  import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}`
    : ''

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}

export function verify(req: ToolCallRequest): Promise<GuardrailResultResponse> {
  return post('/api/verify', req)
}

export function compilePolicy(req: CompilePolicyRequest): Promise<CompilePolicyResponse> {
  return post('/api/compile-policy', req)
}

export function getHealth(): Promise<HealthResponse> {
  return get('/api/health')
}

export function getAuditLog(): Promise<AuditEntry[]> {
  return get('/api/audit')
}

/** Derive WebSocket URL from VITE_API_URL.
 *  http://host:port → ws://host:port
 *  https://host     → wss://host
 *  empty (dev proxy mode) → ws://localhost:5173
 */
export function getWsUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) {
    return apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws/audit'
  }
  // Dev: use Vite's proxy (same origin)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws/audit`
}
