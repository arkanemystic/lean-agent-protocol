// Mirrors backend/app/models.py exactly

export interface ToolCallRequest {
  tool_name: string
  params: Record<string, unknown>
  agent_id: string
  call_id?: string
}

export interface GuardrailResultResponse {
  call_id: string
  verdict: 'allowed' | 'blocked' | 'skipped'
  explanation: string
  lean_trace: string
  latency_us: number
  policy_id: string
  conjecture: string
}

export interface CompilePolicyRequest {
  lean_code: string
  policy_id: string
}

export interface CompilePolicyResponse {
  success: boolean
  error: string | null
  policy_id: string
}

export interface AuditEntry {
  timestamp: string
  call_id: string
  agent_id: string
  tool_name: string
  params: Record<string, unknown>
  verdict: 'allowed' | 'blocked' | 'skipped'
  policy_id: string
  lean_trace: string
  explanation: string
  latency_us: number
  conjecture: string
}

export interface HealthResponse {
  backend: string
  lean_worker: {
    status: string
    policies_loaded?: number
    error?: string
  }
}
