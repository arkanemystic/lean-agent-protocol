import { useCallback, useEffect, useRef, useState } from 'react'
import { compilePolicy, formalizePolicy, getPolicies, uploadPolicyDoc } from '../api/client'
import { HighlightedCode } from './AgentPanel'
import { hljs } from '../lib/lean4-hljs'
import type { FormalizePolicyResponse, PolicyMetadata } from '../types'

// ── Demo policy chips (pre-loaded, for the judge walkthrough) ─────────────────

const DEMO_POLICIES = [
  {
    id: 'CAP001',
    displayId: 'CAP-001',
    label: 'Capital Threshold',
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
    displayId: 'PRC-001',
    label: 'Price Deviation',
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
    displayId: 'POS-001',
    label: 'Position Limit',
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

// ── Sub-components ────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

interface ResultCardProps {
  result: FormalizePolicyResponse
  onDeploy: (policyId: string) => void
}

function FormalizeResultCard({ result, onDeploy }: ResultCardProps) {
  const [editedCode, setEditedCode] = useState(result.lean_code ?? result.skeleton)
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(false)
  const [deployError, setDeployError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryResult, setRetryResult] = useState<FormalizePolicyResponse | null>(null)

  const active = retryResult ?? result
  const displayCode = retryResult ? (retryResult.lean_code ?? retryResult.skeleton) : editedCode
  const isSuccess = active.status === 'success' && active.lean_code

  async function handleDeploy() {
    const code = displayCode.trim()
    if (!code) return
    setDeploying(true)
    setDeployError('')
    try {
      const res = await compilePolicy({
        lean_code: code,
        policy_id: active.policy_id,
        description: active.statement,
      })
      if (res.success) {
        setDeployed(true)
        onDeploy(active.policy_id)
      } else {
        setDeployError(res.error ?? 'Compilation failed')
      }
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setDeploying(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    try {
      const r = await formalizePolicy({ statement: result.statement })
      setRetryResult(r)
    } catch {
      // keep original
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className={`formalize-card formalize-card-${isSuccess ? 'success' : 'failed'}`}>
      <div className="formalize-card-statement">{result.statement}</div>

      {!isSuccess && active.error && (
        <div className="formalize-error">{active.error}</div>
      )}

      {displayCode && (
        <div className="conjecture-box" style={{ marginTop: 8 }}>
          <div className="conjecture-label">
            {isSuccess ? 'Verified Lean 4' : 'Skeleton (edit before deploying)'}
          </div>
          {isSuccess ? (
            <HighlightedCode code={displayCode} />
          ) : (
            <textarea
              className="lean-edit-area"
              value={displayCode}
              onChange={(e) => setEditedCode(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>
      )}

      {deployError && <div className="formalize-error">{deployError}</div>}

      <div className="formalize-card-actions">
        {!isSuccess && (
          <button className="btn btn-ghost btn-sm" onClick={handleRetry} disabled={retrying}>
            {retrying ? <><span className="spinner" /> Retrying…</> : '↺ Retry'}
          </button>
        )}
        {deployed ? (
          <span className="compile-status compile-status-success" style={{ padding: '4px 10px' }}>
            ✓ Deployed as {active.policy_id}
          </span>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={handleDeploy} disabled={deploying || !displayCode.trim()}>
            {deploying ? <><span className="spinner" /> Deploying…</> : 'Deploy →'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  onDeployed?: (policyId: string) => void
}

export function PolicyPanel({ onDeployed }: Props) {
  // PDF upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStage, setUploadStage] = useState<'idle' | 'processing' | 'done'>('idle')
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadResults, setUploadResults] = useState<FormalizePolicyResponse[]>([])
  const [uploadError, setUploadError] = useState('')

  // Manual policy state
  const [nlText, setNlText] = useState('')
  const [leanCode, setLeanCode] = useState('')
  const [activeChip, setActiveChip] = useState<string | null>(null)
  const [formalizing, setFormalizing] = useState(false)
  const [formalizeElapsed, setFormalizeElapsed] = useState(0)
  const [formalizeError, setFormalizeError] = useState('')
  const [compileStatus, setCompileStatus] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle')
  const [compileMessage, setCompileMessage] = useState('')

  // Active policies
  const [policies, setPolicies] = useState<Record<string, PolicyMetadata>>({})

  // Lean 4 syntax highlight ref
  const codeRef = useRef<HTMLDivElement>(null)

  const loadPolicies = useCallback(async () => {
    try {
      const resp = await getPolicies()
      setPolicies(resp.policies)
    } catch {
      // non-fatal — show empty list
    }
  }, [])

  useEffect(() => { loadPolicies() }, [loadPolicies])

  // Re-highlight when lean code changes
  useEffect(() => {
    if (codeRef.current && leanCode) {
      const result = hljs.highlight(leanCode, { language: 'lean4' })
      codeRef.current.innerHTML = result.value
    } else if (codeRef.current) {
      codeRef.current.innerHTML = ''
    }
  }, [leanCode])

  // Elapsed-time ticker while formalizing
  useEffect(() => {
    if (!formalizing) { setFormalizeElapsed(0); return }
    const t = setInterval(() => setFormalizeElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [formalizing])

  // ── PDF upload ────────────────────────────────────────────────────────────

  async function handleExtractAndFormalize() {
    if (!uploadFile) return
    setUploadStage('processing')
    setUploadError('')
    setUploadResults([])
    setUploadProgress('Uploading…')
    try {
      setUploadProgress('Extracting text and policy statements…')
      const results = await uploadPolicyDoc(uploadFile)
      setUploadResults(results)
      setUploadStage('done')
      setUploadProgress(`Found ${results.length} policy statement${results.length === 1 ? '' : 's'}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
      setUploadStage('idle')
    }
  }

  // ── Manual formalize ──────────────────────────────────────────────────────

  function selectChip(policy: (typeof DEMO_POLICIES)[number]) {
    setActiveChip(policy.id)
    setNlText(policy.text)
    setLeanCode('')
    setFormalizeError('')
    setCompileStatus('idle')
    setCompileMessage('')
  }

  async function handleFormalize() {
    if (!nlText.trim()) return
    setFormalizing(true)
    setFormalizeError('')
    setLeanCode('')

    try {
      const res = await formalizePolicy({ statement: nlText })
      if (res.status === 'success' && res.lean_code) {
        setLeanCode(res.lean_code)
      } else {
        setFormalizeError(res.error ?? 'Formalization failed')
        if (res.skeleton) setLeanCode(res.skeleton)
      }
    } catch (err) {
      setFormalizeError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setFormalizing(false)
    }
  }

  async function handleCompile() {
    if (!leanCode.trim()) return
    const policyId = activeChip
      ? DEMO_POLICIES.find((p) => p.id === activeChip)?.displayId ?? 'CUSTOM'
      : `CUSTOM-${Date.now()}`

    setCompileStatus('compiling')
    setCompileMessage('')
    try {
      const res = await compilePolicy({ lean_code: leanCode, policy_id: policyId, description: nlText })
      if (res.success) {
        setCompileStatus('success')
        setCompileMessage(
          res.scenarios_rerun
            ? `Policy ${res.policy_id} deployed — agent scenarios re-running`
            : `Deployed as ${res.policy_id}`
        )
        onDeployed?.(res.policy_id)
        loadPolicies()
      } else {
        setCompileStatus('error')
        setCompileMessage(res.error ?? 'Compilation failed')
      }
    } catch (err) {
      setCompileStatus('error')
      setCompileMessage(err instanceof Error ? err.message : 'Network error')
    }
  }

  function handleDocDeploy(policyId: string) {
    onDeployed?.(policyId)
    loadPolicies()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="panel-content">

      {/* ── 1. PDF Upload section ─────────────────────────────────────────── */}
      <div className="section-label">Upload Policy Document</div>
      <div className="upload-section">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setUploadFile(f)
            setUploadStage('idle')
            setUploadResults([])
            setUploadError('')
          }}
        />
        {!uploadFile ? (
          <button
            className="btn btn-ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose PDF…
          </button>
        ) : (
          <div className="upload-file-row">
            <span className="upload-filename">{uploadFile.name}</span>
            <span className="upload-filesize">{formatBytes(uploadFile.size)}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setUploadFile(null); setUploadStage('idle'); setUploadResults([]) }}
            >
              ✕
            </button>
          </div>
        )}

        {uploadFile && uploadStage !== 'processing' && (
          <button
            className="btn btn-primary"
            onClick={handleExtractAndFormalize}
            style={{ marginTop: 8 }}
          >
            Extract & Formalize
          </button>
        )}

        {uploadStage === 'processing' && (
          <div className="upload-progress">
            <span className="spinner" style={{ marginRight: 8 }} />
            {uploadProgress}
          </div>
        )}

        {uploadError && (
          <div className="compile-status compile-status-error">{uploadError}</div>
        )}
      </div>

      {uploadResults.length > 0 && (
        <div className="formalize-results">
          <div className="section-label">{uploadProgress}</div>
          {uploadResults.map((r, i) => (
            <FormalizeResultCard key={i} result={r} onDeploy={handleDocDeploy} />
          ))}
        </div>
      )}

      {/* ── 2. Divider ────────────────────────────────────────────────────── */}
      <div className="section-divider">
        <span>or write a policy manually</span>
      </div>

      {/* ── 3. Manual entry ───────────────────────────────────────────────── */}
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
        onChange={(e) => { setNlText(e.target.value); setActiveChip(null) }}
      />

      <button
        className="btn btn-primary"
        onClick={handleFormalize}
        disabled={formalizing || !nlText.trim()}
      >
        {formalizing ? <span className="spinner" /> : null}
        {formalizing ? ` Formalizing… ${formalizeElapsed}s` : 'Formalize →'}
      </button>

      {formalizeError && !leanCode && (
        <div className="compile-status compile-status-error">{formalizeError}</div>
      )}

      {leanCode && (
        <>
          {formalizeError && (
            <div className="compile-status compile-status-error">
              ⚠ Formalization failed — showing skeleton. Edit before deploying.<br />
              {formalizeError}
            </div>
          )}

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
            {compileStatus === 'compiling' ? ' Compiling…' : 'Compile & Deploy'}
          </button>

          {compileStatus !== 'idle' && compileStatus !== 'compiling' && (
            <div className={`compile-status compile-status-${compileStatus}`}>
              {compileStatus === 'success' ? '✓ ' : '✗ '}
              {compileMessage}
            </div>
          )}
        </>
      )}

      {/* ── 4. Active Policies ────────────────────────────────────────────── */}
      {Object.keys(policies).length > 0 && (
        <>
          <div className="section-divider" style={{ marginTop: 4 }}>
            <span>active policies</span>
          </div>
          <div className="policy-list">
            {Object.values(policies).map((p) => (
              <div key={p.policy_id} className="policy-card">
                <div className="policy-card-top">
                  <span className="policy-card-id">{p.policy_id}</span>
                  <span className="policy-card-name">{p.display_name}</span>
                </div>
                {p.description && (
                  <div className="policy-card-desc">{p.description}</div>
                )}
                <div className="policy-card-tools">
                  {p.applies_to_tools.map((t) => (
                    <span key={t} className="tool-chip">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
