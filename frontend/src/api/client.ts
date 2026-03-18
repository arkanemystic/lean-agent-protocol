/// <reference types="vite/client" />
import type {
  CompilePolicyRequest,
  CompilePolicyResponse,
  FormalizePolicyRequest,
  FormalizePolicyResponse,
  GuardrailResultResponse,
  HealthResponse,
  RegistryResponse,
  SandboxParseRequest,
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

async function postForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body, // browser sets Content-Type with boundary automatically
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

export function formalizePolicy(req: FormalizePolicyRequest): Promise<FormalizePolicyResponse> {
  return post('/api/formalize-policy', req)
}

export function uploadPolicyDoc(file: File): Promise<FormalizePolicyResponse[]> {
  const form = new FormData()
  form.append('file', file)
  return postForm('/api/upload-policy-doc', form)
}

export function sandboxParse(req: SandboxParseRequest): Promise<ToolCallRequest> {
  return post('/api/sandbox/parse', req)
}

export function getPolicies(): Promise<RegistryResponse> {
  return get('/api/policies')
}

export function getHealth(): Promise<HealthResponse> {
  return get('/api/health')
}

export function getAuditLog(): Promise<AuditEntry[]> {
  return get('/api/audit')
}

/** Derive WebSocket URL from VITE_API_URL. */
export function getWsUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) {
    return apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws/audit'
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws/audit`
}
