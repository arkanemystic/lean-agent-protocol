# Lean-Agent Protocol — Claude Code Brief

## Project Overview

Build a full-stack hackathon demo called the **Lean-Agent Protocol**: a
formally-verified AI guardrail platform for agentic AI systems. The core idea
is that every action a primary AI agent wants to take is intercepted and
submitted to a Lean 4 theorem prover as a mathematical conjecture. The action
only executes if the Lean 4 kernel can formally prove it satisfies pre-compiled
regulatory policy axioms. This replaces probabilistic safety filters with
mathematical certainty.

The demo must be polished, interactive, and fully working for hackathon judges
accessing it remotely via a browser.

---

## Hosting Architecture

**Frontend**: Deployed to Vercel (React + Vite SPA).  
**Backend + Lean worker**: Deployed to a Hetzner VPS via Docker Compose, behind
Caddy (reverse proxy + automatic TLS).

```
Judge's browser
  │
  ├── HTTPS ──► Vercel CDN ──► React frontend (yourapp.vercel.app)
  │                                │
  │                                └── WSS + REST ──► api.yourdomain.com
  │
  └── api.yourdomain.com
        │
        └── Caddy (TLS termination + CORS headers)
              │
              ├── /api/** ──► FastAPI backend (container, port 8000)
              │                     │
              │                     └── internal HTTP ──► Lean worker (container, port 9000)
              │
              └── /ws/audit ──► FastAPI WebSocket endpoint
```

The Lean 4 kernel **must never be called via subprocess from the FastAPI
process directly**. All Lean verification goes through the lean-worker
container over the internal Docker network.

---

## Repository Structure

```
lean-agent-protocol/
├── frontend/                  # React + Vite app (deploys to Vercel)
│   ├── src/
│   │   ├── components/
│   │   │   ├── PolicyEditor.tsx
│   │   │   ├── AgentChat.tsx
│   │   │   └── AuditLog.tsx
│   │   ├── hooks/
│   │   │   └── useAuditStream.ts
│   │   ├── api/
│   │   │   └── client.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── .env.example           # VITE_API_URL=http://localhost:8000
│   ├── vercel.json
│   └── package.json
│
├── backend/                   # FastAPI orchestrator
│   ├── app/
│   │   ├── main.py
│   │   ├── orchestrator.py    # intercepts agent actions, builds conjectures
│   │   ├── policy_env.py      # manages PolicyEnv/ compilation lifecycle
│   │   ├── back_translator.py # Lean error → plain language via Claude API
│   │   ├── agents/
│   │   │   ├── base.py        # BaseAgent abstract class
│   │   │   ├── mock_trading.py
│   │   │   └── stub.py        # SwappableAgent stub
│   │   └── models.py          # Pydantic schemas
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
│
├── lean-worker/               # Lean 4 kernel service
│   ├── PolicyEnv/             # Lake project with policy axioms
│   │   ├── lakefile.lean
│   │   └── PolicyEnv/
│   │       ├── Basic.lean     # core axiom definitions
│   │       └── Verify.lean    # conjecture checker entrypoint
│   ├── worker.py              # HTTP server wrapping lake/lean invocations
│   ├── Dockerfile             # installs elan + lean4 at build time
│   └── requirements.txt
│
├── docker-compose.yml
├── Caddyfile
├── .env.example               # top-level: API keys injected by Coolify
└── README.md
```

---

## Module 1: Policy Translation (NL → Lean 4)

### What it does
A compliance officer types a natural language rule into the Policy Editor panel.
The system calls the Aristotle API to translate it into Lean 4 code, compiles it
via the lean-worker, and stores it in the Policy Environment.

### Aristotle API
- Endpoint: `https://aristotle.harmonic.fun/` (check docs for current endpoint)
- API key: `ARISTOTLE_API_KEY` env var
- Prompt Aristotle to return **only valid Lean 4 theorem/axiom syntax**, no
  prose. Use a strict system prompt that includes the existing PolicyEnv imports
  so Aristotle has context.
- On compilation failure, feed the `lake build` error back to Aristotle and
  retry up to 3 times (iterative self-repair loop).
- Once compiled successfully, save the `.lean` file to `PolicyEnv/` and trigger
  a `lake build` in the lean-worker.

### Example policies to pre-load for the demo
```
"Do not execute trades exceeding 10% of the firm's available daily capital."
"Reject any order where the execution price deviates more than 5% from the 
 15-minute moving average."
"Block any single-asset position that would exceed 25% of total portfolio value."
```

### Lean 4 axiom structure (guide Aristotle toward this pattern)
```lean
import PolicyEnv.Basic

-- Capital threshold policy (CAP-001)
axiom daily_capital : Float
axiom max_trade_fraction : Float := 0.10

theorem cap_001_compliant (trade_value : Float) (available_capital : Float) :
    trade_value ≤ available_capital * max_trade_fraction := by
  native_decide
```

---

## Module 2: Runtime Guardrail Interception

### The agentic loop
1. A mock agent generates a `ToolCall` (e.g. `place_order(symbol, qty, price)`)
2. The FastAPI orchestrator intercepts it **before** it reaches the execution layer
3. The orchestrator serializes the call params + current system state into a
   Lean conjecture string
4. The conjecture is POSTed to the lean-worker at `http://lean-worker:9000/verify`
5. The lean-worker runs `lean --run` against the conjecture with the PolicyEnv
   imported, returns `{"result": "proved" | "refuted", "trace": "..."}` 
6. The orchestrator routes: proved → execution layer, refuted → back-translator

### Lean worker HTTP API
```
POST /verify
Body: { "conjecture": "<lean4 string>", "params": { ...raw action params } }
Response: { "result": "proved"|"refuted"|"error", "trace": "...", "latency_us": 123 }

POST /compile-policy
Body: { "lean_code": "...", "policy_id": "CAP-001" }
Response: { "success": true|false, "error": "..." }

GET /health
Response: { "status": "ok", "policies_loaded": 3 }
```

### Conjecture template (built by orchestrator.py)
```lean
import PolicyEnv.Basic
import PolicyEnv.CAP001  -- imported dynamically based on loaded policies

open PolicyEnv

#check @cap_001_compliant

example : (50000 : Float) ≤ (400000 : Float) * 0.10 := by native_decide
```

The `example` block is what gets dynamically generated from the agent's action
params. `native_decide` resolves arithmetic constraints at the kernel level.

### BaseAgent interface
```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

@dataclass
class ToolCall:
    tool_name: str
    params: dict[str, Any]
    agent_id: str
    call_id: str

@dataclass  
class GuardrailResult:
    call_id: str
    verdict: str  # "allowed" | "blocked"
    explanation: str
    lean_trace: str
    latency_us: int

class BaseAgent(ABC):
    @abstractmethod
    def get_pending_action(self) -> ToolCall | None: ...
    
    @abstractmethod
    def receive_result(self, result: GuardrailResult) -> None: ...
```

### MockTradingAgent scenarios
Pre-program these 6 scenarios that cycle in the demo, alternating pass/fail:

| # | Action | Params | Expected verdict |
|---|--------|--------|-----------------|
| 1 | `place_order` | AAPL, qty=5000, available_capital=400000 | ✅ Allowed (1.25%) |
| 2 | `place_order` | TSLA, qty=50000, available_capital=400000 | ❌ Blocked (12.5%) |
| 3 | `place_order` | NVDA, qty=8000, available_capital=400000 | ✅ Allowed (2%) |
| 4 | `place_order` | MSFT, qty=45000, available_capital=400000 | ❌ Blocked (11.25%) |
| 5 | `rebalance_portfolio` | asset=SPY, new_weight=0.22 | ✅ Allowed (22%) |
| 6 | `rebalance_portfolio` | asset=BTC, new_weight=0.30 | ❌ Blocked (30%) |

---

## Module 3: Audit Trail + Right to Explanation

### Back-translation
When the lean-worker returns `"refuted"`, the `back_translator.py` module calls
the Anthropic Claude API to convert the Lean error trace into a plain-language
explanation.

```python
# back_translator.py
import anthropic

client = anthropic.Anthropic()  # uses ANTHROPIC_API_KEY env var

SYSTEM_PROMPT = """You are a compliance explanation engine for a formal 
verification system. You receive a failed Lean 4 proof trace and the original 
action parameters. Produce a single, clear sentence explaining why the action 
was blocked, citing the specific policy constraint that was violated and the 
exact values involved. Be precise. Do not hedge. Format: 
'Blocked: [reason citing specific values and policy].'"""

def translate(lean_trace: str, action_params: dict, policy_id: str) -> str:
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"Policy: {policy_id}\nParams: {action_params}\nLean trace: {lean_trace}"
        }]
    )
    return response.content[0].text
```

### Audit log schema
Every event (allowed or blocked) gets appended to an immutable JSONL file on
the shared Docker volume:

```json
{
  "timestamp": "2026-03-17T14:23:01.234Z",
  "call_id": "uuid",
  "agent_id": "mock-trading-agent",
  "tool_name": "place_order",
  "params": { "symbol": "TSLA", "qty": 50000 },
  "verdict": "blocked",
  "policy_id": "CAP-001",
  "lean_trace": "...",
  "explanation": "Blocked: order value of $50,000 represents 12.5% of available capital ($400,000), exceeding the 10% limit defined in Policy CAP-001.",
  "latency_us": 4823
}
```

### WebSocket streaming
The FastAPI `/ws/audit` endpoint streams each new audit log entry as a JSON
event to all connected frontend clients in real time. Use `asyncio.Queue` to
fan out events from the orchestrator to the WebSocket handler.

---

## Frontend UI

### Layout
Split-panel layout, full viewport height:
- **Left panel (40%)**: Three tabs — "Policy Editor", "Agent Chat", "System Status"
- **Right panel (60%)**: Live audit log feed

### Design direction
Go for a **dark, terminal-inspired, high-precision aesthetic** — think
Bloomberg terminal meets formal mathematics. This should feel like serious
financial infrastructure, not a consumer app.

- Dark background (near-black, not pure black — e.g. `#0d0f12`)
- Monospace font for Lean 4 code blocks and audit entries (`JetBrains Mono` or
  `IBM Plex Mono` from Google Fonts)
- Sans-serif for UI labels (`IBM Plex Sans`)
- Accent color: a cold electric blue (`#4da6ff`) for allowed verdicts
- Blocked verdicts: amber (`#f5a623`) — not red, red feels alarming; amber
  feels precise and deliberate
- Subtle green pulse animation on the audit log header when new events arrive
- Lean 4 code syntax highlighted (use `highlight.js` with a dark theme)

### Policy Editor panel
- Textarea for natural language policy input
- "Formalize →" button that triggers Aristotle API call
- Two-column output: left = original English, right = generated Lean 4 code
  (syntax highlighted, editable)
- "Compile & Deploy" button that sends the Lean code to `/api/compile-policy`
- Status indicator: compiling → success (with policy ID) → error (with trace)
- Show the 3 pre-loaded demo policies as clickable chips

### Agent Chat panel
- Displays the mock agent's "thought process" as it proposes actions
- Each proposed action shows as a card: tool name, params, a "→ Lean kernel"
  indicator while verifying, then the verdict badge (Allowed/Blocked)
- "Run Agent" button starts the MockTradingAgent cycling through its scenarios
- Latency displayed on each verdict card (e.g. "verified in 4.8ms")
- Show a subtle animated "conjecture being checked..." state during verification

### Audit Log panel
- Reverse-chronological feed of audit entries
- Each entry is a compact card:
  - Timestamp + agent ID (top row)
  - Tool call + params (middle row, monospace)
  - Verdict badge + explanation (bottom row)
  - Expandable to show raw Lean trace
- Color-coded left border: blue = allowed, amber = blocked
- Live indicator (pulsing dot) when WebSocket is connected
- "Export JSONL" button that downloads the full audit log

---

## lean-worker Dockerfile

This is the most critical piece. Build Lean 4 into the image at build time:

```dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    curl git build-essential python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install elan (Lean version manager)
RUN curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y --default-toolchain leanprover/lean4:stable
ENV PATH="/root/.elan/bin:$PATH"

# Pre-warm the Lean toolchain so first-run doesn't time out
RUN lean --version

# Copy and pre-compile the PolicyEnv lake project
WORKDIR /app
COPY PolicyEnv/ ./PolicyEnv/
RUN cd PolicyEnv && lake build

# Install Python HTTP server dependencies
COPY requirements.txt .
RUN pip3 install -r requirements.txt

COPY worker.py .

EXPOSE 9000
CMD ["python3", "worker.py"]
```

**Critical**: The `lake build` step during Docker build pre-compiles all
`.olean` binaries. Runtime verification only does type-checking against these
pre-compiled binaries — this is what gives sub-millisecond latency.

---

## docker-compose.yml

```yaml
version: "3.9"

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ARISTOTLE_API_KEY=${ARISTOTLE_API_KEY}
      - LEAN_WORKER_URL=http://lean-worker:9000
    volumes:
      - policy_data:/app/policy_data
    depends_on:
      - lean-worker
    restart: unless-stopped

  lean-worker:
    build: ./lean-worker
    ports:
      - "9000:9000"   # internal only — Caddy does not expose this externally
    volumes:
      - policy_data:/app/policy_data
    restart: unless-stopped

volumes:
  policy_data:
```

Note: frontend is NOT in docker-compose — it deploys to Vercel independently.

---

## Caddyfile

```
api.yourdomain.com {
    reverse_proxy backend:8000

    header {
        Access-Control-Allow-Origin "https://yourapp.vercel.app"
        Access-Control-Allow-Methods "GET, POST, OPTIONS"
        Access-Control-Allow-Headers "Content-Type, Authorization"
    }
}
```

Replace `yourdomain.com` and `yourapp.vercel.app` with actual values.

---

## Environment Variables

### Backend `.env.example`
```
ANTHROPIC_API_KEY=
ARISTOTLE_API_KEY=
LEAN_WORKER_URL=http://lean-worker:9000
FRONTEND_ORIGIN=https://yourapp.vercel.app
```

### Frontend `.env.example`
```
VITE_API_URL=http://localhost:8000
```

In Vercel dashboard, set:
```
VITE_API_URL=https://api.yourdomain.com
```

---

## Build Order

Implement in this exact sequence. Do not proceed to the next step until the
current one is verified working:

1. **lean-worker first**: Get the Dockerfile building with elan + lean4 + `lake build` 
   succeeding on the base PolicyEnv. Verify `/health` returns 200 and `/verify` 
   returns a result for a trivial conjecture before touching anything else.

2. **Backend orchestrator**: Wire up FastAPI with the lean-worker HTTP client.
   Test the full intercept → conjecture → verify → result loop with hardcoded
   params before connecting the agent.

3. **MockTradingAgent**: Implement the 6 scenarios. Run them against the live
   orchestrator. Confirm 3 allowed, 3 blocked with correct verdicts.

4. **Back-translator**: Add Claude API call on blocked verdicts. Verify
   explanations are coherent and cite specific values.

5. **WebSocket audit stream**: Implement `/ws/audit` and verify events stream
   in real time with a simple `wscat` test before building the frontend.

6. **Frontend**: Build the split-panel UI last, once the backend is fully
   verified. Connect to the real backend from day one — no mocks in the
   frontend.

7. **Docker Compose**: Containerize backend + lean-worker. Verify `docker
   compose up` works end-to-end locally before deploying.

8. **Deployment**: Deploy frontend to Vercel, backend to Hetzner via Coolify
   or direct `docker compose up -d`. Configure Caddy. Smoke test from a
   different network.

---

## Key Constraints (never violate these)

- **Never call `lake` or `lean` via subprocess from the FastAPI process**. All
  Lean invocations go through the lean-worker HTTP service.
- **Never hardcode API keys or domain names**. All config via env vars.
- **Never use `allow_origins=["*"]` in production CORS config**. Use the
  specific Vercel frontend URL.
- **The PolicyEnv volume must persist across container restarts**. Policies
  compiled at runtime must survive a backend restart.
- **The audit log is append-only JSONL**. Never overwrite or truncate it.
- **All API responses must include `latency_us`** so the frontend can display
  verification speed — this is a core demo talking point.

---

## README Requirements

The README must include:

1. **One-paragraph project summary** (suitable for judges unfamiliar with the
   white paper)
2. **Local development setup** (prerequisites: Docker, elan, Node 18+)
3. **Demo walkthrough** with exact steps for judges:
   - Step 1: Open the Policy Editor, click the "Capital Threshold" demo policy
     chip, watch it formalize to Lean 4
   - Step 2: Click "Compile & Deploy", watch the kernel compile it
   - Step 3: Switch to Agent tab, click "Run Agent", watch 6 scenarios cycle
     with live verdicts in the audit log
   - Step 4: Click any blocked entry to expand the Lean proof trace
4. **Deployment instructions** for Vercel + Hetzner
5. **Architecture diagram link** (can reference this brief)

---

## Final Checklist Before Demo

- [ ] `docker compose up` starts clean from scratch on a fresh pull
- [ ] Lean kernel returns results in under 10ms for all 6 mock scenarios
- [ ] WebSocket stays connected for 10+ minutes without dropping
- [ ] All 3 pre-loaded policies survive a backend container restart
- [ ] Vercel frontend loads in under 2 seconds from a cold start
- [ ] Audit log export button downloads valid JSONL
- [ ] Blocked verdicts show plain-language explanations (not raw Lean traces)
- [ ] Policy Editor shows syntax-highlighted Lean 4 output
