"""
FastAPI backend orchestrator for the Lean-Agent Protocol.
"""

import asyncio
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Set

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import back_translator, formalizer, orchestrator
from .models import (
    AuditEntry,
    CompilePolicyRequest,
    CompilePolicyResponse,
    FormalizePolicyRequest,
    FormalizePolicyResponse,
    GuardrailResultResponse,
    PolicyMetadata,
    RegistryResponse,
    SandboxParseRequest,
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

# Policy IDs that must never be overwritten by auto-registration.
_DEFAULT_POLICY_IDS = {"CAP-001", "PRC-001", "POS-001"}

# Mock scenarios mirroring frontend/src/components/AgentPanel.tsx
_MOCK_SCENARIOS: list[dict[str, Any]] = [
    {"tool_name": "place_order",        "params": {"symbol": "AAPL", "qty": 5000,  "available_capital": 400000}, "agent_id": "mock-trading-agent"},
    {"tool_name": "place_order",        "params": {"symbol": "TSLA", "qty": 50000, "available_capital": 400000}, "agent_id": "mock-trading-agent"},
    {"tool_name": "place_order",        "params": {"symbol": "NVDA", "qty": 8000,  "available_capital": 400000}, "agent_id": "mock-trading-agent"},
    {"tool_name": "place_order",        "params": {"symbol": "MSFT", "qty": 45000, "available_capital": 400000}, "agent_id": "mock-trading-agent"},
    {"tool_name": "rebalance_portfolio", "params": {"asset": "SPY", "new_weight": 0.22}, "agent_id": "mock-trading-agent"},
    {"tool_name": "rebalance_portfolio", "params": {"asset": "BTC", "new_weight": 0.30}, "agent_id": "mock-trading-agent"},
]

_SANDBOX_PARSE_SYSTEM = (
    "Parse this financial action into a structured tool call. "
    "Return ONLY a JSON object — no preamble, no markdown. "
    "Fields:\n"
    "- tool_name: string (place_order, rebalance_portfolio, or infer)\n"
    "- params: object with numeric values as numbers\n"
    "Common params: symbol (string), qty (number), price (number), "
    "available_capital (number), new_weight (number, 0-1), asset (string)\n"
    "Infer reasonable defaults for unstated params."
)


# ---------------------------------------------------------------------------- lifespan


@asynccontextmanager
async def lifespan(_app: FastAPI):
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


def _infer_policy_metadata(policy_id: str, lean_code: str, description: str = "") -> dict[str, Any]:
    """
    Build a PolicyMetadata dict from compiled Lean code using heuristics.
    Extracts the function name from the first theorem/def/axiom.
    Uses conservative defaults for everything else.
    """
    # Same sanitisation the lean-worker uses to derive the file name.
    safe_id = "".join(c for c in policy_id if c.isalnum() or c == "_")

    # Extract the first theorem/def/axiom name from the Lean source.
    m = re.search(r"(?:theorem|def|axiom)\s+(\w+)", lean_code)
    lean_function = m.group(1) if m else "customPolicy"

    return {
        "policy_id": policy_id,
        "display_name": description or policy_id,
        "lean_module": f"PolicyEnv.{safe_id}",
        "lean_function": lean_function,
        "applies_to_tools": ["place_order", "rebalance_portfolio"],
        "parameter_map": {"trade_value": "qty", "capital": "available_capital"},
        "param_transforms": {},
        "description": description,
    }


async def _run_one_scenario(scenario: dict[str, Any]) -> None:
    """Run a single mock scenario through orchestrator and broadcast the result."""
    call_id = str(uuid.uuid4())
    try:
        worker_resp = await orchestrator.verify(
            tool_name=scenario["tool_name"],
            params=scenario["params"],
            lean_worker_url=LEAN_WORKER_URL,
        )
        lean_result: str = worker_resp["result"]
        lean_trace: str = worker_resp.get("trace", "")
        latency_us: int = worker_resp.get("latency_us", 0)
        policy_id: str = worker_resp.get("policy_id", "UNKNOWN")
        conjecture: str = worker_resp.get("conjecture", "")

        if lean_result == "proved":
            verdict = "allowed"
            explanation = f"Action satisfies all constraints under {policy_id}."
        elif lean_result == "refuted":
            verdict = "blocked"
            explanation = back_translator.translate(lean_trace, scenario["params"], policy_id)
        elif lean_result == "skipped":
            verdict = "skipped"
            explanation = f"No policies registered for tool: {scenario['tool_name']}"
        else:
            verdict = "blocked"
            explanation = f"Lean kernel error during verification: {lean_trace[:200]}"

        entry = AuditEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            call_id=call_id,
            agent_id=scenario["agent_id"],
            tool_name=scenario["tool_name"],
            params=scenario["params"],
            verdict=verdict,
            policy_id=policy_id,
            lean_trace=lean_trace,
            explanation=explanation,
            latency_us=latency_us,
            conjecture=conjecture,
        )
        _append_audit(entry)
        await broadcaster.publish(entry.model_dump())
    except Exception as exc:
        print(f"_run_one_scenario error: {exc}", flush=True)


async def _rerun_scenarios_background() -> None:
    """Run all mock scenarios sequentially and broadcast each result."""
    for scenario in _MOCK_SCENARIOS:
        await _run_one_scenario(scenario)
        await asyncio.sleep(0.4)   # small visual gap in the audit log feed


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
    worker_resp = await orchestrator.verify(
        tool_name=req.tool_name,
        params=req.params,
        lean_worker_url=LEAN_WORKER_URL,
    )

    lean_result: str = worker_resp["result"]
    lean_trace: str = worker_resp.get("trace", "")
    latency_us: int = worker_resp.get("latency_us", 0)
    policy_id: str = worker_resp.get("policy_id", "UNKNOWN")
    conjecture: str = worker_resp.get("conjecture", "")

    if lean_result == "proved":
        verdict = "allowed"
        explanation = f"Action satisfies all constraints under {policy_id}."
    elif lean_result == "refuted":
        verdict = "blocked"
        explanation = back_translator.translate(lean_trace, req.params, policy_id)
    elif lean_result == "skipped":
        verdict = "skipped"
        explanation = f"No policies registered for tool: {req.tool_name}"
    else:
        verdict = "blocked"
        explanation = f"Lean kernel error during verification: {lean_trace[:200]}"

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

    registered = False
    scenarios_rerun = False

    if result["success"] and req.policy_id not in _DEFAULT_POLICY_IDS:
        # Auto-register the newly compiled policy.
        try:
            meta = _infer_policy_metadata(req.policy_id, req.lean_code, req.description)
            register_policy(meta)
            registered = True
        except Exception as exc:
            print(f"Auto-registration failed for {req.policy_id}: {exc}", flush=True)

        # Fire mock scenarios in the background so the audit log populates via WebSocket.
        asyncio.create_task(_rerun_scenarios_background())
        scenarios_rerun = True

    return CompilePolicyResponse(
        success=result["success"],
        error=result.get("error"),
        policy_id=req.policy_id,
        needs_registration=result["success"],
        registered=registered,
        scenarios_rerun=scenarios_rerun,
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
    """
    if metadata.policy_id != policy_id:
        metadata = metadata.model_copy(update={"policy_id": policy_id})
    register_policy(metadata.model_dump())
    return metadata


# ---------------------------------------------------------------------------- formalization


@app.post("/api/formalize-policy", response_model=FormalizePolicyResponse)
async def api_formalize_policy(req: FormalizePolicyRequest):
    """
    Two-step pipeline: NL statement → Lean 4 skeleton → Aristotle-verified Lean 4.
    Takes 30-120 seconds; runs fully async.
    """
    result = await formalizer.formalize(req.statement)
    return FormalizePolicyResponse(**result)


@app.post("/api/upload-policy-doc")
async def api_upload_policy_doc(file: UploadFile = File(...)):
    """
    Accept a PDF, extract text, extract policy statements via Claude,
    formalize each one (up to 10) via Aristotle, return results array.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 10 MB limit.")

    # Extract text from PDF
    try:
        import io
        import pypdf  # type: ignore[import]
        reader = pypdf.PdfReader(io.BytesIO(contents))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(p for p in pages if p.strip())
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"PDF text extraction failed: {exc}")

    if not text.strip():
        raise HTTPException(status_code=422, detail="No readable text found in PDF.")

    # Extract atomic policy statements via Claude
    try:
        statements = await formalizer.extract_policy_statements(text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Statement extraction failed: {exc}")

    # Cap at 10 statements
    statements = statements[:10]

    # Formalize each statement
    results = []
    for statement in statements:
        result = await formalizer.formalize(statement)
        results.append(result)

    return results


# ---------------------------------------------------------------------------- sandbox


@app.post("/api/sandbox/parse")
async def api_sandbox_parse(req: SandboxParseRequest):
    """
    Parse a plain-English financial action into a structured ToolCall via Claude.
    Returns a JSON object suitable for POST /api/verify.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not set.")

    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=_SANDBOX_PARSE_SYSTEM,
        messages=[{"role": "user", "content": req.description}],
    )
    raw = response.content[0].text.strip()
    # Strip markdown code fences if Claude adds them
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Claude returned invalid JSON: {exc}")


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
