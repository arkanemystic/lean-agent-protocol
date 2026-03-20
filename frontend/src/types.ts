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
  elab_us?: number | null
}

export interface CompilePolicyRequest {
  lean_code: string
  policy_id: string
  description?: string
}

export interface CompilePolicyResponse {
  success: boolean
  error: string | null
  policy_id: string
  needs_registration?: boolean
  registered?: boolean
  scenarios_rerun?: boolean
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
  elab_us?: number | null
}

export interface HealthResponse {
  backend: string
  lean_worker: {
    status: string
    policies_loaded?: number
    error?: string
  }
}

// ── Policy registry ──────────────────────────────────────────────────────────

export interface PolicyMetadata {
  policy_id: string
  display_name: string
  lean_module: string
  lean_function: string
  applies_to_tools: string[]
  parameter_map: Record<string, string>
  param_transforms: Record<string, string>
  description: string
}

export interface RegistryResponse {
  policies: Record<string, PolicyMetadata>
  count: number
}

// ── Formalization pipeline ───────────────────────────────────────────────────

export interface FormalizePolicyRequest {
  statement: string
}

export interface FormalizePolicyResponse {
  statement: string
  skeleton: string
  lean_code: string | null
  status: 'success' | 'failed'
  error: string | null
  policy_id: string
}

// ── Sandbox ──────────────────────────────────────────────────────────────────

export interface SandboxParseRequest {
  description: string
}
