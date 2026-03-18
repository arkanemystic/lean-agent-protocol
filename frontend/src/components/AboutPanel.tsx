import type { Tab } from '../App'

interface Props {
  onNavigate: (tab: Tab) => void
}

// ── Comparison table ──────────────────────────────────────────────────────────

type TableRow =
  | { type: 'border'; text: string }
  | { type: 'row'; left: string; right: string; header?: boolean }

const COMPARISON_TABLE: TableRow[] = [
  { type: 'border', text: '  ┌─────────────────────────────┬──────────────────────────┐' },
  { type: 'row', left: ' Probabilistic Guardrail    ', right: ' Axiom Protocol          ', header: true },
  { type: 'border', text: '  ├─────────────────────────────┼──────────────────────────┤' },
  { type: 'row', left: ' "98.3% confident: blocked" ', right: ' "Proved: BLOCKED"       ' },
  { type: 'row', left: ' ~500ms LLM inference       ', right: ' ~5ms kernel check       ' },
  { type: 'row', left: ' Vulnerable to jailbreaks   ', right: ' Mathematically bounded  ' },
  { type: 'row', left: ' Fails SEC 15c3-5           ', right: ' Satisfies SEC 15c3-5    ' },
  { type: 'border', text: '  └─────────────────────────────┴──────────────────────────┘' },
]

// ── Flow diagram ──────────────────────────────────────────────────────────────

type DiagramSegment = { text: string; color: string }
type DiagramLine = DiagramSegment[]

const M = '#5a6070'  // muted — boxes, arrows
const G = '#00ff41'  // proved
const A = '#f5a623'  // refuted

const DIAGRAM: DiagramLine[] = [
  [{ text: '  ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐', color: M }],
  [{ text: '  │  AI Agent   │────▶│   Orchestrator   │────▶│  Lean 4     │', color: M }],
  [{ text: '  │  proposes   │     │   builds Lean 4  │     │  Kernel     │', color: M }],
  [{ text: '  │  an action  │     │   conjecture     │     │  verifies   │', color: M }],
  [{ text: '  └─────────────┘     └──────────────────┘     └──────┬──────┘', color: M }],
  [{ text: '                                                       │', color: M }],
  [{ text: '                              ┌────────────────────────┤', color: M }],
  [{ text: '                              │                        │', color: M }],
  [
    { text: '                         ', color: M },
    { text: '┌────▼─────┐', color: G },
    { text: '           ', color: M },
    { text: '┌─────▼────┐', color: A },
  ],
  [
    { text: '                         ', color: M },
    { text: '│  PROVED  │', color: G },
    { text: '           ', color: M },
    { text: '│ REFUTED  │', color: A },
  ],
  [
    { text: '                         ', color: M },
    { text: '│  action  │', color: G },
    { text: '           ', color: M },
    { text: '│  action  │', color: A },
  ],
  [
    { text: '                         ', color: M },
    { text: '│ executes │', color: G },
    { text: '           ', color: M },
    { text: '│ blocked  │', color: A },
  ],
  [
    { text: '                         ', color: M },
    { text: '└──────────┘', color: G },
    { text: '           ', color: M },
    { text: '└──────────┘', color: A },
  ],
]

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="about-section">
      <div className="about-section-label">{label}</div>
      {children}
    </section>
  )
}

function Rule() {
  return <div className="about-rule" />
}

interface NavCardProps {
  prefix: string
  title: string
  body: string
  linkLabel: string
  tab: Tab
  onNavigate: (tab: Tab) => void
}

function NavCard({ prefix, title, body, linkLabel, tab, onNavigate }: NavCardProps) {
  return (
    <div className="about-nav-card" onClick={() => onNavigate(tab)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate(tab) }}>
      <div className="about-nav-card-title">
        <span className="about-nav-card-prefix">{prefix}</span> {title}
      </div>
      <div className="about-nav-card-body">{body}</div>
      <div className="about-nav-card-link">{linkLabel}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AboutPanel({ onNavigate }: Props) {
  return (
    <div className="about-panel">

      {/* Header */}
      <div className="about-header">
        AXIOM PROTOCOL // SYSTEM DOCUMENTATION // v1.0.0
      </div>
      <Rule />

      {/* Synopsis */}
      <Section label="SYNOPSIS">
        <p className="about-body">
          Axiom Protocol is a formally-verified AI guardrail system.
          Every action proposed by an AI agent is intercepted and
          submitted to the Lean 4 theorem prover as a mathematical
          conjecture. Execution is permitted if and only if the kernel
          proves the action satisfies all compiled policy axioms.
        </p>
        <p className="about-body" style={{ marginTop: 8 }}>
          This is not probabilistic safety. This is{' '}
          <span className="about-green">mathematical proof</span>.
        </p>
      </Section>

      {/* The Problem */}
      <Section label="THE PROBLEM">
        <p className="about-body">
          Traditional AI guardrails ask a language model to evaluate
          another language model's output. The result is a confidence
          score — "98.3% likely compliant." In financial markets,
          that 0.7% is catastrophic.
        </p>
        <p className="about-body" style={{ marginTop: 8 }}>
          SEC Rule 15c3-5 requires controls under "direct and exclusive
          control" of the broker-dealer. A probabilistic filter cannot
          satisfy this requirement. It can only estimate compliance.
        </p>
        <div className="about-code-block" style={{ marginTop: 12 }}>
          {COMPARISON_TABLE.map((row, i) =>
            row.type === 'border' ? (
              <div key={i} className="about-table-border">{row.text}</div>
            ) : (
              <div key={i} className="about-table-row">
                <span className="about-table-border">{'  │'}</span>
                <span className={row.header ? 'about-table-header-left' : 'about-table-left'}>
                  {row.left}
                </span>
                <span className="about-table-border">│</span>
                <span className={row.header ? 'about-table-header-right' : 'about-table-right'}>
                  {row.right}
                </span>
                <span className="about-table-border">│</span>
              </div>
            )
          )}
        </div>
      </Section>

      {/* How It Works */}
      <Section label="HOW IT WORKS">
        <div className="about-code-block">
          {DIAGRAM.map((line, i) => (
            <div key={i}>
              {line.map((seg, j) => (
                <span key={j} style={{ color: seg.color }}>{seg.text}</span>
              ))}
            </div>
          ))}
        </div>
        <p className="about-body" style={{ marginTop: 12 }}>
          The conjecture builder serializes the agent's tool call
          parameters into Lean 4 syntax. The kernel type-checks the
          proof against pre-compiled policy axioms stored in the
          Policy Environment. Verification typically completes in
          under 10ms on warm cache.
        </p>
      </Section>

      {/* Navigate */}
      <Section label="NAVIGATE THE SYSTEM">
        <div className="about-nav-grid">
          <NavCard
            prefix="0x01"
            title="POLICIES"
            body={
              'Upload financial policy documents or write rules in plain English. ' +
              'Aristotle formalizes them into Lean 4 axioms.'
            }
            linkLabel="> OPEN POLICIES ──────▶"
            tab="policies"
            onNavigate={onNavigate}
          />
          <NavCard
            prefix="0x02"
            title="AGENT"
            body={
              'Watch the mock trading agent fire 6 scenarios against active policies. ' +
              'See real-time Lean 4 verification with proof traces for each verdict.'
            }
            linkLabel="> OPEN AGENT ─────────▶"
            tab="agent"
            onNavigate={onNavigate}
          />
          <NavCard
            prefix="0x03"
            title="SANDBOX"
            body={
              'Describe any financial action in plain English. The system parses it, ' +
              'builds a conjecture, and verifies it live against all active policies.'
            }
            linkLabel="> OPEN SANDBOX ───────▶"
            tab="sandbox"
            onNavigate={onNavigate}
          />
          <NavCard
            prefix="0x04"
            title="STATUS"
            body={
              'Live health of all system components. Lean kernel, policy environment, ' +
              'and orchestrator status.'
            }
            linkLabel="> OPEN STATUS ────────▶"
            tab="status"
            onNavigate={onNavigate}
          />
        </div>
      </Section>

      {/* Dependencies */}
      <Section label="DEPENDENCIES">
        <div className="about-deps">
          {[
            { name: 'lean4',       version: 'v4.28.0', desc: 'Theorem prover, Microsoft Research' },
            { name: 'aristotlelib', version: 'v1.0.0',  desc: 'Neural-symbolic AI, Harmonic' },
            { name: 'fastapi',     version: 'latest',  desc: 'Async Python orchestrator' },
            { name: 'docker',      version: 'latest',  desc: 'Containerized execution environment' },
          ].map((dep) => (
            <div key={dep.name} className="about-dep-row">
              <span className="about-dep-name">{dep.name}</span>
              <span className="about-dep-version">{dep.version}</span>
              <span className="about-dep-desc">{dep.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Regulatory */}
      <Section label="REGULATORY COMPLIANCE">
        <div className="about-regs">
          {[
            { label: 'SEC 15c3-5',  desc: 'Pre-trade hard controls, capital thresholds' },
            { label: 'OCC 2011-12', desc: 'Model risk management, supervisory obligations' },
            { label: 'EU AI Act',   desc: 'Right to explanation, audit trail mandate' },
            { label: 'ECOA / FCRA', desc: 'Adverse action notices, plain-language reasons' },
          ].map((reg) => (
            <div key={reg.label} className="about-reg-row">
              <span className="about-reg-label">{reg.label}</span>
              <span className="about-reg-sep">  ──  </span>
              <span className="about-reg-desc">{reg.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Footer */}
      <Rule />
      <div className="about-footer">
        <div>// Based on: Aristotle: IMO-level Automated Theorem Proving</div>
        <div>
          // <a
            href="https://arxiv.org/abs/2510.01346"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >arxiv.org/abs/2510.01346</a>
        </div>
        <div>&nbsp;</div>
        <div>// AWS Cedar verification:</div>
        <div>
          // <a
            href="https://aws.amazon.com/blogs/opensource/lean-into-verified-software-development"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >aws.amazon.com/blogs/opensource/lean-into-verified-software-development</a>
        </div>
      </div>

    </div>
  )
}
