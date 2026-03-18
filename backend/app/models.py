from typing import Any
from pydantic import BaseModel, Field
import uuid


class ToolCallRequest(BaseModel):
    tool_name: str
    params: dict[str, Any]
    agent_id: str = "mock-trading-agent"
    call_id: str = Field(default_factory=lambda: str(uuid.uuid4()))


class GuardrailResultResponse(BaseModel):
    call_id: str
    verdict: str            # "allowed" | "blocked" | "skipped"
    explanation: str
    lean_trace: str
    latency_us: int
    policy_id: str
    conjecture: str = ""    # exact Lean 4 string submitted to the kernel


class CompilePolicyRequest(BaseModel):
    lean_code: str
    policy_id: str
    description: str = ""   # optional human-readable description for auto-registration


class CompilePolicyResponse(BaseModel):
    success: bool
    error: str | None = None
    policy_id: str
    needs_registration: bool = False    # True after a successful compile (legacy)
    registered: bool = False            # True if auto-registration succeeded
    scenarios_rerun: bool = False       # True if mock scenario re-run was kicked off


class AuditEntry(BaseModel):
    timestamp: str
    call_id: str
    agent_id: str
    tool_name: str
    params: dict[str, Any]
    verdict: str
    policy_id: str
    lean_trace: str
    explanation: str
    latency_us: int
    conjecture: str = ""    # exact Lean 4 string submitted to the kernel


# ── Policy registry schemas ──────────────────────────────────────────────────

class PolicyMetadata(BaseModel):
    policy_id: str
    display_name: str
    lean_module: str = "PolicyEnv.Basic"
    lean_function: str
    applies_to_tools: list[str]
    parameter_map: dict[str, str]       # ordered: semantic_name → tool_param_key
    param_transforms: dict[str, str] = {}  # semantic_name → "bps" | "int"
    description: str = ""


class RegistryResponse(BaseModel):
    policies: dict[str, PolicyMetadata]
    count: int


# ── Formalization pipeline schemas ───────────────────────────────────────────

class FormalizePolicyRequest(BaseModel):
    statement: str


class FormalizePolicyResponse(BaseModel):
    statement: str
    skeleton: str
    lean_code: str | None
    status: str             # "success" | "failed"
    error: str | None
    policy_id: str


# ── Sandbox schemas ───────────────────────────────────────────────────────────

class SandboxParseRequest(BaseModel):
    description: str
