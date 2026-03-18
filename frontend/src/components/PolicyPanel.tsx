import { useEffect, useRef, useState } from 'react'
import { compilePolicy } from '../api/client'
import { hljs } from '../lib/lean4-hljs'

const DEMO_POLICIES = [
  {
    id: 'CAP001',
    label: 'Capital Threshold',
    displayId: 'CAP-001',
    text: "Do not execute trades exceeding 10% of the firm's available daily capital.",
    lean: `import PolicyEnv.Basic

-- CAP-001: Capital threshold policy
namespace PolicyEnv

def cap001MaxBps : Nat := 1000

def cap001Compliant (tradeValue availableCapital : Nat) : Bool :=
  tradeWithinCapital tradeValue availableCapital cap001MaxBps

end PolicyEnv`,
  },
  {
    id: 'PRC001',
    label: 'Price Deviation',
    displayId: 'PRC-001',
    text: 'Reject any order where the execution price deviates more than 5% from the 15-minute moving average.',
    lean: `import PolicyEnv.Basic

-- PRC-001: Price deviation policy
namespace PolicyEnv

def prc001MaxDeviationBps : Nat := 500

def prc001Compliant (execPrice refPrice : Nat) : Bool :=
  priceWithinDeviation execPrice refPrice prc001MaxDeviationBps

end PolicyEnv`,
  },
  {
    id: 'POS001',
    label: 'Position Limit',
    displayId: 'POS-001',
    text: 'Block any single-asset position that would exceed 25% of total portfolio value.',
    lean: `import PolicyEnv.Basic

-- POS-001: Single-asset position limit
namespace PolicyEnv

def pos001LimitBps : Nat := 2500

def pos001Compliant (newWeightBps : Nat) : Bool :=
  positionWithinLimit newWeightBps pos001LimitBps

end PolicyEnv`,
  },
]

type CompileStatus = 'idle' | 'compiling' | 'success' | 'error'

export function PolicyPanel() {
  const [nlText, setNlText] = useState('')
  const [leanCode, setLeanCode] = useState('')
  const [activeChip, setActiveChip] = useState<string | null>(null)
  const [formalizing, setFormalizing] = useState(false)
  const [compileStatus, setCompileStatus] = useState<CompileStatus>('idle')
  const [compileMessage, setCompileMessage] = useState('')
  const codeRef = useRef<HTMLDivElement>(null)

  // Re-highlight whenever lean code changes
  useEffect(() => {
    if (codeRef.current && leanCode) {
      const result = hljs.highlight(leanCode, { language: 'lean4' })
      codeRef.current.innerHTML = result.value
    } else if (codeRef.current) {
      codeRef.current.innerHTML = ''
    }
  }, [leanCode])

  function selectChip(policy: (typeof DEMO_POLICIES)[number]) {
    setActiveChip(policy.id)
    setNlText(policy.text)
    setLeanCode('')
    setCompileStatus('idle')
    setCompileMessage('')
  }

  async function handleFormalize() {
    if (!nlText.trim()) return
    setFormalizing(true)
    // Match against demo policies
    const match = DEMO_POLICIES.find((p) => nlText.trim() === p.text.trim())
    if (match) {
      await new Promise((r) => setTimeout(r, 400)) // brief "thinking" pause
      setLeanCode(match.lean)
    } else {
      // No Aristotle key configured — show a scaffold
      await new Promise((r) => setTimeout(r, 600))
      setLeanCode(
        `import PolicyEnv.Basic\n\n-- TODO: Aristotle API not configured.\n-- Manually write your Lean 4 policy here.\nnamespace PolicyEnv\n\n-- Your policy definition\n\nend PolicyEnv`
      )
    }
    setFormalizing(false)
  }

  async function handleCompile() {
    if (!leanCode.trim()) return
    const policyId = activeChip
      ? DEMO_POLICIES.find((p) => p.id === activeChip)?.displayId ?? 'CUSTOM'
      : `CUSTOM-${Date.now()}`

    setCompileStatus('compiling')
    setCompileMessage('')
    try {
      const res = await compilePolicy({ lean_code: leanCode, policy_id: policyId })
      if (res.success) {
        setCompileStatus('success')
        setCompileMessage(`Deployed as ${res.policy_id}`)
      } else {
        setCompileStatus('error')
        setCompileMessage(res.error ?? 'Compilation failed')
      }
    } catch (err) {
      setCompileStatus('error')
      setCompileMessage(err instanceof Error ? err.message : 'Network error')
    }
  }

  return (
    <div className="panel-content">
      <div className="chip-row">
        {DEMO_POLICIES.map((p) => (
          <button
            key={p.id}
            className={`chip${activeChip === p.id ? ' chip-active' : ''}`}
            onClick={() => selectChip(p)}
          >
            <span className="chip-id">{p.displayId}</span>
            <span className="chip-label">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="section-label">Natural Language Policy</div>
      <textarea
        className="nl-textarea"
        placeholder="Describe your compliance rule in plain English…"
        value={nlText}
        onChange={(e) => setNlText(e.target.value)}
      />

      <button
        className="btn btn-primary"
        onClick={handleFormalize}
        disabled={formalizing || !nlText.trim()}
      >
        {formalizing ? <span className="spinner" /> : null}
        {formalizing ? 'Formalizing…' : 'Formalize →'}
      </button>

      {leanCode && (
        <>
          <div className="two-col">
            <div className="two-col-pane">
              <div className="pane-header">English</div>
              <div className="pane-text">{nlText}</div>
            </div>
            <div className="two-col-pane">
              <div className="pane-header">Lean 4</div>
              <pre className="code-block">
                <code ref={codeRef} className="hljs" />
              </pre>
            </div>
          </div>

          <button
            className="btn btn-secondary"
            onClick={handleCompile}
            disabled={compileStatus === 'compiling'}
          >
            {compileStatus === 'compiling' ? <span className="spinner" /> : null}
            {compileStatus === 'compiling' ? 'Compiling…' : 'Compile & Deploy'}
          </button>

          {compileStatus !== 'idle' && compileStatus !== 'compiling' && (
            <div className={`compile-status compile-status-${compileStatus}`}>
              {compileStatus === 'success' ? '✓ ' : '✗ '}
              {compileMessage}
            </div>
          )}
        </>
      )}
    </div>
  )
}
