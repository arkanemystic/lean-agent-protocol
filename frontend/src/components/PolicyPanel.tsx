import { useCallback, useEffect, useRef, useState } from 'react'
import { compilePolicy, formalizePolicy, getPolicies, uploadPolicyDoc } from '../api/client'
import { HighlightedCode } from './AgentPanel'
import { hljs } from '../lib/lean4-hljs'
import { useAppState } from '../store/AppContext'
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
  const { state, dispatch } = useAppState()
  const { policyEditor, pdfUpload } = state

  // PDF upload file object lives locally (not serializable to context)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  // Compile status is local (transient per-session interaction)
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
    if (codeRef.current && policyEditor.formalizedLean) {
      const result = hljs.highlight(policyEditor.formalizedLean, { language: 'lean4' })
      codeRef.current.innerHTML = result.value
    } else if (codeRef.current) {
      codeRef.current.innerHTML = ''
    }
  }, [policyEditor.formalizedLean])

  // Elapsed-time ticker while formalizing
  useEffect(() => {
    if (policyEditor.status !== 'formalizing') {
      dispatch({ type: 'SET_POLICY_EDITOR', payload: { elapsedSeconds: 0 } })
      return
    }
    const t = setInterval(() => {
      dispatch({ type: 'SET_POLICY_EDITOR', payload: { elapsedSeconds: policyEditor.elapsedSeconds + 1 } })
    }, 1000)
    return () => clearInterval(t)
  }, [policyEditor.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── PDF upload ────────────────────────────────────────────────────────────

  async function handleExtractAndFormalize() {
    if (!uploadFile) return
    dispatch({ type: 'SET_PDF_UPLOAD', payload: { status: 'processing', error: '', results: [], progress: 'Uploading…' } })
    try {
      dispatch({ type: 'SET_PDF_UPLOAD', payload: { progress: 'Extracting text and policy statements…' } })
      const results = await uploadPolicyDoc(uploadFile)
      dispatch({ type: 'SET_PDF_UPLOAD', payload: {
        results,
        status: 'done',
        progress: `Found ${results.length} policy statement${results.length === 1 ? '' : 's'}`,
      }})
    } catch (err) {
      dispatch({ type: 'SET_PDF_UPLOAD', payload: {
        error: err instanceof Error ? err.message : 'Upload failed',
        status: 'idle',
      }})
    }
  }

  // ── Manual formalize ──────────────────────────────────────────────────────

  function selectChip(policy: (typeof DEMO_POLICIES)[number]) {
    dispatch({ type: 'SET_POLICY_EDITOR', payload: {
      activeChip: policy.id,
      inputText: policy.text,
      formalizedLean: null,
      error: null,
      status: 'idle',
    }})
    setCompileStatus('idle')
    setCompileMessage('')
  }

  async function handleFormalize() {
    const text = policyEditor.inputText
    if (!text.trim()) return
    dispatch({ type: 'SET_POLICY_EDITOR', payload: { status: 'formalizing', error: null, formalizedLean: null, elapsedSeconds: 0 } })

    try {
      const res = await formalizePolicy({ statement: text })
      if (res.status === 'success' && res.lean_code) {
        dispatch({ type: 'SET_POLICY_EDITOR', payload: { formalizedLean: res.lean_code, policyId: res.policy_id, status: 'success', error: null } })
      } else {
        dispatch({ type: 'SET_POLICY_EDITOR', payload: {
          error: res.error ?? 'Formalization failed',
          formalizedLean: res.skeleton ?? null,
          status: 'error',
        }})
      }
    } catch (err) {
      dispatch({ type: 'SET_POLICY_EDITOR', payload: {
        error: err instanceof Error ? err.message : 'Network error',
        status: 'error',
      }})
    }
  }

  async function handleCompile() {
    const leanCode = policyEditor.formalizedLean
    if (!leanCode?.trim()) return
    const policyId = policyEditor.activeChip
      ? DEMO_POLICIES.find((p) => p.id === policyEditor.activeChip)?.displayId ?? 'CUSTOM'
      : policyEditor.policyId ?? `CUSTOM-${Date.now()}`

    setCompileStatus('compiling')
    setCompileMessage('')
    try {
      const res = await compilePolicy({ lean_code: leanCode, policy_id: policyId, description: policyEditor.inputText })
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

  const isFormalizing = policyEditor.status === 'formalizing'
  const leanCode = policyEditor.formalizedLean
  const formalizeError = policyEditor.error
  const formalizeElapsed = policyEditor.elapsedSeconds

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
            dispatch({ type: 'SET_PDF_UPLOAD', payload: {
              filename: f?.name ?? null,
              status: 'idle',
              results: [],
              error: '',
              progress: '',
            }})
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
              onClick={() => {
                setUploadFile(null)
                dispatch({ type: 'SET_PDF_UPLOAD', payload: { filename: null, status: 'idle', results: [], progress: '', error: '' } })
              }}
            >
              ✕
            </button>
          </div>
        )}

        {uploadFile && pdfUpload.status !== 'processing' && (
          <button
            className="btn btn-primary"
            onClick={handleExtractAndFormalize}
            style={{ marginTop: 8 }}
          >
            Extract & Formalize
          </button>
        )}

        {pdfUpload.status === 'processing' && (
          <div className="upload-progress">
            <span className="spinner" style={{ marginRight: 8 }} />
            {pdfUpload.progress}
          </div>
        )}

        {pdfUpload.error && (
          <div className="compile-status compile-status-error">{pdfUpload.error}</div>
        )}
      </div>

      {pdfUpload.results.length > 0 && (
        <div className="formalize-results">
          <div className="section-label">{pdfUpload.progress}</div>
          {pdfUpload.results.map((r, i) => (
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
            className={`chip${policyEditor.activeChip === p.id ? ' chip-active' : ''}`}
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
        value={policyEditor.inputText}
        onChange={(e) => dispatch({ type: 'SET_POLICY_EDITOR', payload: { inputText: e.target.value, activeChip: null } })}
      />

      <button
        className="btn btn-primary"
        onClick={handleFormalize}
        disabled={isFormalizing || !policyEditor.inputText.trim()}
      >
        {isFormalizing ? <span className="spinner" /> : null}
        {isFormalizing ? ` Formalizing… ${formalizeElapsed}s` : 'Formalize →'}
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
              <div className="pane-text">{policyEditor.inputText}</div>
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
