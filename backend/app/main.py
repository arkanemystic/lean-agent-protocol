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
from typing import Any, AsyncGenerator, Set

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

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
]
# Always include local dev origins
for _dev_origin in ["http://localhost:5173", "http://localhost:3000"]:
    if _dev_origin not in ALLOWED_ORIGINS:
        ALLOWED_ORIGINS.append(_dev_origin)

print(f"CORS allowed origins: {ALLOWED_ORIGINS}", flush=True)

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
    allow_origin_regex=r"https://.*\.vercel\.app",
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


# ---------------------------------------------------------------------------- log broadcaster


class LogBroadcaster:
    """Fan-out server log events to all SSE clients."""

    def __init__(self) -> None:
        self._queues: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    def publish(self, level: str, message: str) -> None:
        """Synchronous — safe to call from non-async helpers."""
        event = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "msg": message,
        }
        data = f"data: {json.dumps(event)}\n\n"
        for q in list(self._queues):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass  # drop if client is too slow


log_broadcaster = LogBroadcaster()


def log_event(level: str, message: str) -> None:
    """Emit a log event to all connected SSE clients."""
    log_broadcaster.publish(level, message)


# ---------------------------------------------------------------------------- helpers


def _ensure_audit_dir() -> None:
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)


def _append_audit(entry: AuditEntry) -> None:
    _ensure_audit_dir()
    with AUDIT_LOG_PATH.open("a") as fh:
        fh.write(entry.model_dump_json() + "\n")


def _short_display_name(statement: str, cap: int = 40) -> str:
    """
    Derive a short title from a natural-language policy statement.

    Takes the first 5 words, strips leading stop-words (any/a/the/all/no),
    then title-cases the result and truncates to `cap` characters with "…".
    """
    words = statement.strip().split()
    # Drop a leading article/quantifier so "Any strategy must…" → "Strategy Must…"
    _LEADING_STOP = {"any", "a", "an", "the", "all", "no", "each", "every"}
    if words and words[0].lower() in _LEADING_STOP:
        words = words[1:]
    title_words = words[:5]
    title = " ".join(title_words).rstrip(".,;:").title()
    if len(title) > cap:
        title = title[: cap - 1].rstrip() + "…"
    return title or statement[:cap]


def _next_custom_policy_id() -> str:
    """Return the next available CUSTOM-NNN id by inspecting the live registry."""
    registry = load_registry()
    nums = []
    for k in registry.keys():
        m = re.match(r"CUSTOM-(\d+)$", k)
        if m:
            nums.append(int(m.group(1)))
    return f"CUSTOM-{(max(nums, default=0) + 1):03d}"


def _infer_policy_metadata(
    policy_id: str,
    lean_code: str,
    description: str = "",
    module_name: str | None = None,
) -> dict[str, Any]:
    """
    Build a PolicyMetadata dict from compiled Lean code using heuristics.
    Extracts the function name from the first theorem/def/axiom.
    Uses conservative defaults for everything else.

    module_name: the safe_id returned by the lean-worker (e.g. "CAP002").
    Falls back to re-deriving it from policy_id if not supplied.
    """
    safe_id = module_name or "".join(c for c in policy_id if c.isalnum() or c == "_")

    # Extract the first theorem/def/axiom name from the Lean source.
    m = re.search(r"(?:theorem|def|axiom)\s+(\w+)", lean_code)
    lean_function = m.group(1) if m else "customPolicy"

    display_name = _short_display_name(description) if description else policy_id

    return {
        "policy_id": policy_id,
        "display_name": display_name,
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
    log_event("info", f"→ {scenario['tool_name']}({scenario['params']})")
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
        elab_us: int | None = worker_resp.get("elab_us")

        if lean_result == "proved":
            verdict = "allowed"
            explanation = f"Action satisfies all constraints under {policy_id}."
        elif lean_result == "refuted":
            verdict = "blocked"
            explanation = back_translator.translate(lean_trace, scenario["params"], policy_id)
        elif lean_result == "skipped":
            verdict = "skipped"
            explanation = (
                worker_resp.get("explanation")
                or f"No policies registered for tool: {scenario['tool_name']}"
            )
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
            elab_us=elab_us,
        )
        _append_audit(entry)
        await broadcaster.publish(entry.model_dump())
        log_event(
            "success" if verdict == "allowed" else "warn",
            f"  {verdict.upper()} — {policy_id} — {latency_us/1000:.1f}ms",
        )
    except Exception as exc:
        log_event("error", f"  scenario error: {exc}")
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
    elab_us: int | None = worker_resp.get("elab_us")

    if lean_result == "proved":
        verdict = "allowed"
        explanation = f"Action satisfies all constraints under {policy_id}."
    elif lean_result == "refuted":
        verdict = "blocked"
        explanation = back_translator.translate(lean_trace, req.params, policy_id)
    elif lean_result == "skipped":
        verdict = "skipped"
        explanation = (
            worker_resp.get("explanation")
            or f"No policies registered for tool: {req.tool_name}"
        )
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
        elab_us=elab_us,
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
        elab_us=elab_us,
    )


@app.post("/api/compile-policy", response_model=CompilePolicyResponse)
async def api_compile_policy(req: CompilePolicyRequest):
    # Normalise timestamp-style CUSTOM ids (e.g. "CUSTOM-1773854413427") to
    # sequential ones (CUSTOM-001, CUSTOM-002 …) before touching the registry.
    policy_id = req.policy_id
    if re.match(r"CUSTOM-\d{5,}$", policy_id):
        policy_id = _next_custom_policy_id()

    log_event("info", f"Compiling policy {policy_id}…")
    result = await orchestrator.compile_policy(
        lean_code=req.lean_code,
        policy_id=policy_id,
        lean_worker_url=LEAN_WORKER_URL,
    )

    registered = False
    scenarios_rerun = False

    if result["success"]:
        log_event("success", f"Policy {policy_id} compiled successfully")
    else:
        log_event("error", f"Policy {policy_id} compilation failed: {result.get('error', '?')}")

    if result["success"] and policy_id not in _DEFAULT_POLICY_IDS:
        # Auto-register the newly compiled policy.
        try:
            meta = _infer_policy_metadata(
                policy_id, req.lean_code, req.description,
                module_name=result.get("module_name"),
            )
            register_policy(meta)
            registered = True
            log_event("info", f"Policy {policy_id} registered in registry")
        except Exception as exc:
            log_event("warn", f"Auto-registration failed for {policy_id}: {exc}")
            print(f"Auto-registration failed for {policy_id}: {exc}", flush=True)

        # Fire mock scenarios in the background so the audit log populates via WebSocket.
        log_event("info", "Re-running mock scenarios against updated policy set…")
        asyncio.create_task(_rerun_scenarios_background())
        scenarios_rerun = True

    return CompilePolicyResponse(
        success=result["success"],
        error=result.get("error"),
        policy_id=policy_id,
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
    log_event("info", f"Formalizing policy statement: {req.statement[:80]}…")
    try:
        result = await formalizer.formalize(req.statement)
        if result.get("status") == "success":
            log_event("success", f"Formalization succeeded → {result.get('policy_id', '?')}")
        else:
            log_event("warn", f"Formalization partial: {result.get('error', 'unknown error')}")
        return FormalizePolicyResponse(**result)
    except Exception as exc:
        log_event("error", f"Formalization failed: {exc}")
        raise


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
    log_event("info", f"Processing PDF: {file.filename} ({len(contents):,} bytes)")
    try:
        import io
        import pypdf  # type: ignore[import]
        reader = pypdf.PdfReader(io.BytesIO(contents))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(p for p in pages if p.strip())
        log_event("info", f"Extracted {len(reader.pages)} pages, {len(text):,} chars")
    except Exception as exc:
        log_event("error", f"PDF extraction failed: {exc}")
        raise HTTPException(status_code=422, detail=f"PDF text extraction failed: {exc}")

    if not text.strip():
        raise HTTPException(status_code=422, detail="No readable text found in PDF.")

    # Extract atomic policy statements via Claude
    log_event("info", "Extracting policy statements via Claude…")
    try:
        statements = await formalizer.extract_policy_statements(text)
        log_event("info", f"Found {len(statements)} policy statement(s)")
    except Exception as exc:
        log_event("error", f"Statement extraction failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Statement extraction failed: {exc}")

    # Cap at 10 statements
    statements = statements[:10]

    # Formalize each statement
    results = []
    for i, statement in enumerate(statements, 1):
        log_event("info", f"[{i}/{len(statements)}] Formalizing: {statement[:60]}…")
        result = await formalizer.formalize(statement)
        status = result.get("status", "?")
        log_event(
            "success" if status == "success" else "warn",
            f"[{i}/{len(statements)}] {status} → {result.get('policy_id', '?')}",
        )
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

    log_event("info", f"Sandbox: parsing '{req.description[:60]}…'")
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
        parsed = json.loads(raw)
        log_event("success", f"Sandbox: parsed as {parsed.get('tool_name', '?')}({list(parsed.get('params', {}).keys())})")
        return parsed
    except json.JSONDecodeError as exc:
        log_event("error", f"Sandbox: Claude returned invalid JSON: {exc}")
        raise HTTPException(status_code=500, detail=f"Claude returned invalid JSON: {exc}")


# ---------------------------------------------------------------------------- SSE log stream


@app.get("/api/logs/stream")
async def api_log_stream():
    """
    Server-Sent Events stream of backend log messages.
    Reconnects automatically via the EventSource protocol.
    """
    q = log_broadcaster.subscribe()

    async def generator() -> AsyncGenerator[str, None]:
        # Send a keepalive comment immediately so the browser knows the stream is live.
        yield ": connected\n\n"
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield data
                except asyncio.TimeoutError:
                    # Send a keepalive ping to prevent proxy timeouts.
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            log_broadcaster.unsubscribe(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable Nginx/Caddy/Traefik buffering
        },
    )


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