# Lean-Agent Protocol — Research Demonstration

**A proof-of-concept implementation of the formal verification architecture described in:**

> Rashie, D. & Rashi, V. (2026). *Type-Checked Compliance: Deterministic Guardrails for Agentic Financial Systems Using Lean 4 Theorem Proving.* Preprint: [link](https://drive.google.com/file/d/1QpcXIZrWuyNA1PjlrcSC-gy3wWccYEMx/view?usp=sharing)

This repository is a working demonstration of the paper's core thesis: that agentic AI systems operating in regulated domains can be governed by **mathematically verified compliance guarantees** rather than probabilistic classifiers. Every action a trading agent proposes is intercepted and submitted to the Lean 4 theorem prover as a formal conjecture. Execution is permitted if and only if the kernel produces a machine-verifiable proof that the action satisfies pre-compiled policy axioms.

---

## What This Demo Implements

### ✅ Fully Implemented

**Lean 4 kernel as deterministic execution gateway** (§2.3). The `lean-worker` service runs the Lean 4 type-checker against pre-compiled `.olean` binaries. Verification is synchronous, binary (proved/refuted), and produces a formal proof trace on every decision. This is the architectural centerpiece of the paper.

**Basis-point integer arithmetic for kernel-decidability** (§2.4 footnote / README rationale). The paper proposes `native_decide` for arithmetic constraint resolution. This demo implements all policy thresholds as integer basis-point predicates (e.g., `tradeValue * 10000 ≤ availableCapital * maxBps`) rather than floating-point comparisons, which are not decidable at the Lean kernel level. The `decide` tactic resolves these in microseconds on warm cache.

**Synchronous runtime interception** (§2.3.2). The FastAPI orchestrator intercepts every mock agent action, serializes it into a Lean conjecture using a typed parameter map, submits it to the lean-worker, and routes the binary result — before any execution layer is reached.

**Policy registry with typed parameter mapping** (§2.3.1). Policies are stored with explicit `parameter_map` and `param_transforms` metadata that govern how tool call arguments are projected into Lean function arguments. This prevents the ad-hoc string injection that would undermine semantic guarantees.

**Back-translation of proof failures to plain language** (§3.3). When the kernel refutes a conjecture, the error trace is passed to Claude (claude-sonnet-4-6) with a strict system prompt to produce a single, values-citing adverse action explanation — approximating the ECOA/FCRA compliance requirement described in the paper.

**Append-only audit log with WebSocket streaming** (§6.3). Every agentic decision — allowed or blocked — is appended to an immutable JSONL file and broadcast in real time to connected clients. Each entry includes the exact Lean 4 conjecture submitted to the kernel, the raw proof trace, and wall-clock latency.

**Two-step NL → Lean 4 formalization pipeline** (§2.1). Natural language policy statements are converted to Lean 4 axioms in two stages: Claude generates a skeleton with `sorry` placeholders, then `aristotlelib` (Harmonic AI's Aristotle API client) is called to fill the proof. Compilation failures trigger rollback; the lean-worker restores the previous clean build state.

---

### ⚠️ Partially Implemented

**Aristotle integration** (§2.1). The paper describes Aristotle as the primary auto-formalization engine — an IMO-gold-level neural-symbolic model that achieved Lean 4 proof generation for five of six 2025 IMO problems. This demo calls the `aristotlelib` client for the proof-completion step. However, the Aristotle API is in limited access as of this writing; the skeleton generation step is performed by Claude rather than Aristotle's informal reasoning engine. In production, Aristotle would handle the full NL → formal Lean pipeline end-to-end.

**Reverse auto-formalization / "back-translation"** (§3.3). The paper describes a Herald-dataset-grounded RAG pipeline that translates failed Lean proof states into compliant adverse action notices, with a one-to-one mapping from the specific violated axiom to the consumer-facing explanation. This demo approximates this with a direct Claude API call, which is more flexible but less formally grounded — the explanation is not guaranteed to precisely reflect the logical structure of the failed proof.

**Regulatory policy coverage** (§3). The three demo policies (CAP-001, PRC-001, POS-001) are illustrative implementations of the regulatory intent described in §3.1–3.2. They are not verbatim formalizations of SEC Rule 15c3-5 text, OCC Bulletin 2011-12 model risk requirements, or FINRA Rule 3110 supervisory procedures. The paper argues that Aristotle can auto-formalize the actual regulatory language; this demo formalizes the simplified numeric constraints that such rules reduce to.

---

### ❌ Not Implemented in This Demo

**WebAssembly execution sandboxing** (§4.3). The paper argues that Docker containers are insufficient because they share the host kernel, and proposes WebAssembly (WASM) with WASI capability-based security as the execution substrate. This demo uses Docker containers, which is appropriate for a research demonstration but does not satisfy the paper's security argument for production deployment.

**MenTaL concept-symbol constraints** (§4.2.3). The paper proposes algorithmically enforcing a concept-to-symbol mapping table during formalization to prevent adversarial symbol drift — where a synonym or rephrasing causes Aristotle to map a restricted action variable to a permitted Lean symbol. This demo does not implement such constraints; the formalization pipeline is susceptible to the formalization drift attack described in §4.2.2.

**Shadow verification / Phase 1 MVP** (§6.1). The paper's implementation roadmap begins with an asynchronous shadow mode where the Lean kernel's judgments are compared against human compliance reviews before any synchronous interception. This demo operates in synchronous mode only.

**Multi-agent mesh and MPSC scheduling** (§6.3). The paper's Phase 3 describes bounded multi-producer single-consumer mailboxes and work-stealing schedulers for concurrent multi-agent deployments under production load. This demo handles one agent sequentially.

**Cryptographically signed audit log** (§6.3). The paper describes audit entries as inextricably linked to immutable Lean 4 mathematical proofs via cryptographic binding. This demo uses append-only JSONL — immutable by convention and container volume configuration, but not cryptographically signed or tamper-evident.

**Logical jailbreak mitigations** (§4.2.1). The paper discusses LogiBreak, QueryAttack, and sentence-level perturbation attacks on the formalization layer. No adversarial robustness testing or countermeasures are implemented here.

---

## Architecture

```
Browser
  │
  ├── HTTPS ──► Vercel CDN ──► React + Vite frontend
  │                                │
  │                                └── REST + WSS ──► api.devrashie.space
  │
  └── api.devrashie.space (Hetzner VPS)
        │
        └── Traefik (TLS + routing, via Coolify)
              │
              ├── /api/** ──► FastAPI orchestrator  :8000
              │                     │
              │                     └── HTTP ──► Lean 4 worker  :9000 (internal)
              │
              └── /ws/audit ──► FastAPI WebSocket (asyncio.Queue fan-out)
```

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Visualization, policy editor, audit log |
| Orchestrator | FastAPI + uvicorn | Conjecture builder, policy registry, back-translator |
| Lean worker | Python http.server + elan + lake | Lean 4 kernel wrapper, policy compilation |
| Verification | Lean 4 `decide` tactic | Decidable Nat arithmetic, binary proof/refutation |
| Formalization | Claude (skeleton) + Aristotle API (proof) | NL → Lean 4 pipeline |
| Audit log | Append-only JSONL on Docker volume | Immutable decision record, WebSocket stream |

### Why `decide` rather than `native_decide`

The paper references `native_decide` (§2.3.2 conjecture template). This demo uses `decide` for the policy predicates. Both tactics resolve decidable propositions; `native_decide` compiles the decision procedure to native code for larger problems. For the arithmetic constraints used here (basis-point comparisons over `Nat`), `decide` is sufficient and avoids the additional trust assumption introduced by native code generation.

---

## Live Demo

| Service | URL |
|---|---|
| Frontend | https://axiom.devrashie.space |
| Backend API | https://api.devrashie.space |

---

## Local Development

### Prerequisites

- Docker Desktop ≥ 4.x
- Node.js ≥ 18
- (Optional) [elan](https://github.com/leanprover/elan) + Lean 4 `v4.28.0` for editing `.lean` files locally

### Setup

```bash
# 1. Clone
git clone https://github.com/YOURUSER/lean-agent-protocol
cd lean-agent-protocol

# 2. Configure environment
cp .env.example .env
# Required: ANTHROPIC_API_KEY (back-translation and skeleton generation)
# Optional: ARISTOTLE_API_KEY (Harmonic AI proof completion)

# 3. Start backend services
docker compose up --build backend lean-worker

# 4. Start frontend dev server
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8000`. No CORS configuration needed locally.

---

## Walkthrough

### 1 — Deploy a Policy

Open the **Policies** tab. Select one of the three pre-loaded demo policy chips (CAP-001, PRC-001, POS-001), or type a natural language rule. Click **Formalize →** to run the NL → Lean 4 pipeline. Click **Compile & Deploy** to submit the Lean code to the lean-worker, which runs `lake build`, bakes the `.olean` binary, and registers the policy in the runtime registry.

### 2 — Run the Agent

Switch to the **Agent** tab. Click **▶ Run Agent**. Six mock trading scenarios fire sequentially, each intercepted by the orchestrator, formalized into a Lean conjecture, and submitted to the kernel. Three prove (AAPL, NVDA, SPY) and three refute (TSLA, MSFT, BTC).

### 3 — Inspect the Audit Log

Every decision streams to the right panel via WebSocket. Expand any entry to see the **verification breakdown** — the exact Lean 4 conjecture submitted, the parsed function name and arguments, and the kernel's result. Blocked entries include the plain-language adverse action explanation from the back-translator.

### 4 — Try the Sandbox

The **Sandbox** tab accepts a plain-English financial action description, parses it into a structured `ToolCallRequest` via Claude, and runs it through the live guardrail. Scenarios can be saved and re-run as policy changes are deployed.

---

## Deployment

### VPS (backend + lean-worker)

The backend runs via Docker Compose on a Hetzner VPS managed by [Coolify](https://coolify.io/). Coolify's Traefik instance handles TLS and routing automatically from the labels on the `backend` service.

```bash
# Set secrets in Coolify environment variables panel:
#   ANTHROPIC_API_KEY=...
#   FRONTEND_ORIGIN=https://axiom.devrashie.space
#   (ARISTOTLE_API_KEY=... if available)

# Coolify runs docker compose up on each deploy.
# lean-worker has no external port binding — internal network only.
```

For manual deploys:

```bash
VPS_HOST=YOUR_VPS_IP ./deploy.sh
```

Post-deploy validation:

```bash
API_BASE=https://api.devrashie.space ./smoke-test.sh
```

### Vercel (frontend)

1. Import the repo into Vercel, set root directory to `frontend`
2. Add environment variable: `VITE_API_URL=https://api.devrashie.space`
3. Deploy — Vercel auto-detects Vite

---

## Environment Variables

### VPS `.env`

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API — back-translation and skeleton generation |
| `ARISTOTLE_API_KEY` | No | Harmonic AI — Lean proof completion (graceful fallback if absent) |
| `FRONTEND_ORIGIN` | Yes | Vercel URL for CORS, e.g. `https://axiom.devrashie.space` |

### Vercel

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://api.devrashie.space` |

---

## Repository Structure

```
lean-agent-protocol/
├── frontend/              React + Vite SPA (Vercel)
├── backend/               FastAPI orchestrator (Docker)
│   └── app/
│       ├── orchestrator.py    conjecture builder, policy dispatch
│       ├── policy_registry.py typed parameter map, persistence
│       ├── back_translator.py Claude-backed adverse action notices
│       └── formalizer.py      NL → skeleton → Aristotle pipeline
├── lean-worker/           Lean 4 kernel service (Docker)
│   └── PolicyEnv/
│       └── PolicyEnv/
│           ├── Basic.lean     core predicates (tradeWithinCapital, etc.)
│           ├── CAP001.lean    10% capital threshold
│           ├── PRC001.lean    5% price deviation
│           └── POS001.lean    25% position limit
├── docker-compose.yml
├── deploy.sh
└── smoke-test.sh
```

---

## Citation

```bibtex
@article{rashie2026typechecked,
  title   = {Type-Checked Compliance: Deterministic Guardrails for Agentic Financial Systems Using Lean 4 Theorem Proving},
  author  = {Rashie, Devakh and Rashi, Veda},
  year    = {2026},
  note    = {Preprint available at https://devrashie.space}
}
```
