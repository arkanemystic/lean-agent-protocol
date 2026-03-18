# Lean-Agent Protocol

**Formally verified AI guardrails for autonomous financial agents.**

## What Is This?

Lean-Agent Protocol replaces probabilistic safety filters with mathematical proof. When an AI agent wants to take an action — say, placing a large trade — that action is intercepted and submitted to the [Lean 4](https://lean-lang.org/) theorem prover as a formal conjecture. The Lean kernel either *proves* the action satisfies every loaded compliance policy, or *refutes* it with a machine-verifiable counter-example. Only proved actions execute.

Formal verification means the system doesn't *estimate* whether a rule was followed — it *proves* it, with the same mathematical rigor used to verify cryptographic protocols and operating system kernels. In finance, where a single miscalculated trade can cost millions, replacing "we think this is safe" with "this is provably safe" is the difference between a guardrail and a real guarantee.

The demo runs three pre-compiled policies (capital threshold, price deviation, position limit) against a mock trading agent cycling through six scenarios. Three pass, three fail — and every decision is logged to an immutable audit trail with a plain-language explanation of exactly why a blocked trade was blocked.

---

## Live Demo

| Service | URL |
|---|---|
| Frontend | https://axiom.devrashie.space |
| Backend API | https://api.devrashie.space |

---

## Local Development

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x
- Node.js ≥ 18
- (Optional) [elan](https://github.com/leanprover/elan) + Lean 4 for editing `.lean` files locally

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOURUSER/lean-agent-protocol
cd lean-agent-protocol

# 2. Create your .env from the example
cp .env.example .env
# Fill in ANTHROPIC_API_KEY (for plain-language explanations)
# ARISTOTLE_API_KEY is optional (for NL → Lean 4 translation)

# 3. Start backend + lean-worker (Caddy is skipped in local mode)
docker compose up --build backend lean-worker

# 4. In a separate terminal, start the frontend dev server
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8000`, so no CORS configuration is needed locally.

---

## Judge Demo Walkthrough

Open **https://YOURAPP.vercel.app** and follow these steps:

### Step 1 — Formalize a Policy
1. Click the **Policies** tab in the left panel
2. Click the **"Capital Threshold"** chip (CAP-001)
3. The natural language rule populates the textarea
4. Click **"Formalize →"** — watch the right column fill with Lean 4 code

### Step 2 — Compile & Deploy
1. Click **"Compile & Deploy"**
2. The status indicator cycles: *compiling…* → **✓ Deployed as CAP-001**
3. The Lean kernel has type-checked the policy and compiled it to `.olean` binaries

### Step 3 — Run the Agent
1. Click the **Agent** tab
2. Click **"▶ Run Agent"**
3. Watch six mock trading scenarios fire sequentially (1.5 s apart)
4. Each card shows: tool call → `→ verifying with Lean kernel…` → **ALLOWED** or **BLOCKED** badge with latency

### Step 4 — Watch the Audit Log
1. The right panel fills in real time as each scenario completes
2. Each entry shows timestamp, agent ID, tool call, verdict, and plain-language explanation
3. Blue left border = allowed · Amber left border = blocked

### Step 5 — Inspect a Proof Trace
1. Click any **BLOCKED** entry in the audit log
2. Click **"▼ Show Lean trace"** at the bottom of the card
3. The raw Lean 4 kernel output appears — e.g.:
   ```
   Tactic `decide` proved that the proposition
     PolicyEnv.cap001Compliant 50000 400000 = true
   is false
   ```
   This is the formal proof that the trade violated the policy.

### Step 6 — Export the Audit Log
1. Click **"Export JSONL"** in the audit log header
2. A `.jsonl` file downloads — one JSON object per line, immutable record of every decision

---

## Architecture

```
Judge's browser
  │
  ├── HTTPS ──► Vercel CDN ──► React + Vite frontend
  │                                │
  │                                └── REST + WSS ──► api.YOURDOMAIN.com
  │
  └── api.YOURDOMAIN.com (Hetzner VPS)
        │
        └── Caddy (TLS termination + CORS)
              │
              ├── /api/** ──► FastAPI backend  :8000
              │                     │
              │                     └── HTTP ──► Lean worker  :9000 (internal)
              │
              └── /ws/audit ──► FastAPI WebSocket (asyncio.Queue fan-out)
```

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | IBM Plex fonts, highlight.js Lean 4 |
| Backend | FastAPI + uvicorn | Orchestrator, back-translator, audit log |
| Lean worker | Python http.server + elan + lake | `.olean` binaries baked into Docker image |
| Reverse proxy | Traefik (via Coolify) | Automatic TLS via Let's Encrypt |
| Verification | Lean 4 `decide` tactic | Nat basis-point arithmetic, fully decidable |
| Audit log | Append-only JSONL on shared Docker volume | Streams over WebSocket |

### Why basis-point integer arithmetic?

Lean 4's kernel can *decide* propositions over `Nat` (natural numbers) at compile time — `decide` either produces a proof term or a refutation. `Float` comparisons are not kernel-decidable. All policy thresholds are expressed as integer basis points (1 bps = 0.01%), so `tradeValue ≤ 10%` becomes `tradeValue * 10000 ≤ availableCapital * 1000`, which the kernel resolves in microseconds.

---

## Deployment

### VPS (backend + lean-worker via Coolify)

The backend runs on a VPS managed by [Coolify](https://coolify.io/). Coolify's built-in Traefik proxy handles TLS termination and routing — no Caddy or manual reverse proxy configuration needed.

```bash
# 1. In Coolify, create a new Docker Compose application pointing at this repo.

# 2. Configure secrets in the Coolify environment variables panel:
#    ANTHROPIC_API_KEY=...
#    FRONTEND_ORIGIN=https://axiom.devrashie.space

# 3. Coolify will run docker compose up automatically on each deploy.
#    Traefik picks up the labels on the backend service and routes
#    api.devrashie.space → backend:8000 with automatic TLS.
```

The `docker-compose.yml` backend service carries Traefik labels so Coolify's proxy routes `api.devrashie.space` to it automatically. The lean-worker has no external port binding and is only reachable within the Docker network.

#### Manual / SSH deploys

```bash
# From your local machine:
VPS_HOST=YOUR_VPS_IP ./deploy.sh
```

#### Smoke test

```bash
API_BASE=https://api.devrashie.space ./smoke-test.sh
```

### Vercel (frontend)

1. Import the repo into Vercel
2. Set root directory to `frontend`
3. Add environment variable:
   ```
   VITE_API_URL=https://api.devrashie.space
   ```
4. Deploy — Vercel auto-detects Vite and runs `npm run build`

The `vercel.json` SPA rewrite rule handles client-side routing.

---

## Environment Variables

### Root `.env` (VPS)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for plain-language explanations |
| `ARISTOTLE_API_KEY` | Optional | Aristotle API key for NL → Lean 4 translation |
| `FRONTEND_ORIGIN` | Yes | Full Vercel URL, e.g. `https://YOURAPP.vercel.app` |

### Vercel environment variables

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://api.YOURDOMAIN.com` |

---

## Project Structure

```
lean-agent-protocol/
├── frontend/          React + Vite SPA (deploys to Vercel)
├── backend/           FastAPI orchestrator (Docker)
├── lean-worker/       Lean 4 kernel service (Docker)
│   └── PolicyEnv/     Lake project — policy axioms baked in at build time
├── docker-compose.yml backend + lean-worker + Caddy
├── Caddyfile          Reverse proxy config (fill in domain before deploy)
├── deploy.sh          One-command VPS deploy script
├── smoke-test.sh      Post-deploy API validation
└── .env.example       Template — copy to .env and fill in secrets
```
