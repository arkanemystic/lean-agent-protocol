"""
FastAPI backend orchestrator for the Lean-Agent Protocol.
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Set

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import back_translator, orchestrator
from .models import (
    AuditEntry,
    CompilePolicyRequest,
    CompilePolicyResponse,
    GuardrailResultResponse,
    PolicyMetadata,
    RegistryResponse,
    ToolCallRequest,
)
from .policy_registry import (
    load_registry,
    register_policy,
    save_registry,
    seed_if_missing,
)

load_dotenv()

LEAN_WORKER_URL = os.environ.get("LEAN_WORKER_URL", "http://lean-worker:9000")
AUDIT_LOG_PATH = Path(os.environ.get("AUDIT_LOG_PATH", "/app/policy_data/audit.log"))

# FRONTEND_ORIGIN may be a comma-separated list of allowed origins.
_raw_origins = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS: list[str] = [
    o.strip() for o in _raw_origins.split(",") if o.strip()
] + ["http://localhost:5173", "http://localhost:3000"]


# ---------------------------------------------------------------------------- lifespan


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Seed registry.json with the 3 default policies on first run
    seed_if_missing()
    yield


app = FastAPI(
    title="Lean-Agent Protocol Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex="https://.*\\.vercel\\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# ---------------------------------------------------------------------------- audit broadcaster


class AuditBroadcaster:
    """Fan-out audit log events to all connected WebSocket clients."""

    def __init__(self) -> None:
        self._queues: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    async def publish(self, event: dict) -> None:
        for q in list(self._queues):
            await q.put(event)


broadcaster = AuditBroadcaster()


# ---------------------------------------------------------------------------- helpers


def _ensure_audit_dir() -> None:
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)


def _append_audit(entry: AuditEntry) -> None:
    _ensure_audit_dir()
    with AUDIT_LOG_PATH.open("a") as fh:
        fh.write(entry.model_dump_json() + "\n")


# ---------------------------------------------------------------------------- routes


@app.get("/api/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{LEAN_WORKER_URL}/health")
            lean_health = resp.json()
    except Exception as exc:
        lean_health = {"status": "unreachable", "error": str(exc)}

    return {"backend": "ok", "lean_worker": lean_health}


@app.post("/api/verify", response_model=GuardrailResultResponse)
async def api_verify(req: ToolCallRequest):
    # 1. Build conjectures from registry and call lean-worker
    worker_resp = await orchestrator.verify(
        tool_name=req.tool_name,
        params=req.params,
        lean_worker_url=LEAN_WORKER_URL,
    )

    lean_result: str = worker_resp["result"]     # "proved" | "refuted" | "error" | "skipped"
    lean_trace: str = worker_resp.get("trace", "")
    latency_us: int = worker_resp.get("latency_us", 0)
    policy_id: str = worker_resp.get("policy_id", "UNKNOWN")
    conjecture: str = worker_resp.get("conjecture", "")

    # 2. Determine verdict and explanation
    if lean_result == "proved":
        verdict = "allowed"
        explanation = f"Action satisfies all constraints under {policy_id}."
    elif lean_result == "refuted":
        verdict = "blocked"
        explanation = back_translator.translate(lean_trace, req.params, policy_id)
    elif lean_result == "skipped":
        verdict = "skipped"
        explanation = f"No policies registered for tool: {req.tool_name}"
    else:  # "error"
        verdict = "blocked"
        explanation = f"Lean kernel error during verification: {lean_trace[:200]}"

    # 3. Write audit log entry
    entry = AuditEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        call_id=req.call_id,
        agent_id=req.agent_id,
        tool_name=req.tool_name,
        params=req.params,
        verdict=verdict,
        policy_id=policy_id,
        lean_trace=lean_trace,
        explanation=explanation,
        latency_us=latency_us,
        conjecture=conjecture,
    )
    _append_audit(entry)

    # 4. Broadcast to WebSocket clients (non-blocking)
    asyncio.create_task(broadcaster.publish(entry.model_dump()))

    return GuardrailResultResponse(
        call_id=req.call_id,
        verdict=verdict,
        explanation=explanation,
        lean_trace=lean_trace,
        latency_us=latency_us,
        policy_id=policy_id,
        conjecture=conjecture,
    )


@app.post("/api/compile-policy", response_model=CompilePolicyResponse)
async def api_compile_policy(req: CompilePolicyRequest):
    result = await orchestrator.compile_policy(
        lean_code=req.lean_code,
        policy_id=req.policy_id,
        lean_worker_url=LEAN_WORKER_URL,
    )
    return CompilePolicyResponse(
        success=result["success"],
        error=result.get("error"),
        policy_id=req.policy_id,
        needs_registration=result["success"],   # prompt frontend to register metadata
    )


# ---------------------------------------------------------------------------- policy registry


@app.get("/api/policies", response_model=RegistryResponse)
async def api_get_policies():
    """Return the full policy registry."""
    raw = load_registry()
    policies = {k: PolicyMetadata(**v) for k, v in raw.items()}
    return RegistryResponse(policies=policies, count=len(policies))


@app.post("/api/policies/{policy_id}/register", response_model=PolicyMetadata)
async def api_register_policy(policy_id: str, metadata: PolicyMetadata):
    """
    Add or update a policy entry in the registry.
    Called automatically by the frontend after a successful /api/compile-policy.
    The policy_id in the URL must match metadata.policy_id.
    """
    if metadata.policy_id != policy_id:
        metadata = metadata.model_copy(update={"policy_id": policy_id})
    register_policy(metadata.model_dump())
    return metadata


# ---------------------------------------------------------------------------- audit log


@app.get("/api/audit")
async def api_audit_log():
    """Return the full audit log as a list of entries."""
    _ensure_audit_dir()
    if not AUDIT_LOG_PATH.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in AUDIT_LOG_PATH.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return entries


# ---------------------------------------------------------------------------- WebSocket


@app.websocket("/ws/audit")
async def ws_audit(ws: WebSocket):
    await ws.accept()
    q = broadcaster.subscribe()
    try:
        while True:
            event = await q.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        broadcaster.unsubscribe(q)
