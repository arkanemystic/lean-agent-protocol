import { useState } from 'react'
import { sandboxParse, verify } from '../api/client'
import { AgentCard, VerdictCard } from './AgentPanel'
import type { CardState } from './AgentPanel'
import type { GuardrailResultResponse, ToolCallRequest } from '../types'

const STORAGE_KEY = 'lean_agent_saved_scenarios'

interface SavedScenario {
  id: string
  name: string
  toolCall: ToolCallRequest
  lastResult?: GuardrailResultResponse
  savedAt: string
}

function loadSaved(): SavedScenario[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveSaved(items: SavedScenario[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function SandboxPanel() {
  const [nlInput, setNlInput] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsedJson, setParsedJson] = useState('')
  const [parseError, setParseError] = useState('')

  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<GuardrailResultResponse | null>(null)
  const [verifyError, setVerifyError] = useState('')

  const [saveName, setSaveName] = useState('')
  const [saved, setSaved] = useState<SavedScenario[]>(loadSaved)

  // Per-saved-scenario running state
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, GuardrailResultResponse>>({})

  // ── Parse ──────────────────────────────────────────────────────────────────

  async function handleParse() {
    if (!nlInput.trim()) return
    setParsing(true)
    setParseError('')
    setVerifyResult(null)
    setVerifyError('')
    try {
      const result = await sandboxParse({ description: nlInput })
      setParsedJson(JSON.stringify(result, null, 2))
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed')
    } finally {
      setParsing(false)
    }
  }

  // ── Verify ─────────────────────────────────────────────────────────────────

  async function handleVerify() {
    let toolCall: ToolCallRequest
    try {
      toolCall = JSON.parse(parsedJson) as ToolCallRequest
    } catch {
      setVerifyError('Invalid JSON — fix the tool call above before verifying.')
      return
    }
    setVerifying(true)
    setVerifyResult(null)
    setVerifyError('')
    try {
      const result = await verify({ ...toolCall, agent_id: toolCall.agent_id ?? 'sandbox' })
      setVerifyResult(result)
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verify failed')
    } finally {
      setVerifying(false)
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  function handleSave() {
    let toolCall: ToolCallRequest
    try {
      toolCall = JSON.parse(parsedJson) as ToolCallRequest
    } catch {
      return
    }
    const name = saveName.trim() || `Scenario ${new Date().toLocaleTimeString()}`
    const item: SavedScenario = {
      id: `${Date.now()}-${Math.random()}`,
      name,
      toolCall,
      lastResult: verifyResult ?? undefined,
      savedAt: new Date().toISOString(),
    }
    const updated = [item, ...saved]
    setSaved(updated)
    saveSaved(updated)
    setSaveName('')
  }

  function handleDeleteSaved(id: string) {
    const updated = saved.filter((s) => s.id !== id)
    setSaved(updated)
    saveSaved(updated)
  }

  async function handleRunSaved(scenario: SavedScenario) {
    setRunningId(scenario.id)
    try {
      const result = await verify({ ...scenario.toolCall, agent_id: 'sandbox' })
      const updated = saved.map((s) =>
        s.id === scenario.id ? { ...s, lastResult: result } : s
      )
      setSaved(updated)
      saveSaved(updated)
      setRunResults((prev) => ({ ...prev, [scenario.id]: result }))
    } catch {
      // ignore — keep previous result
    } finally {
      setRunningId(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Build a CardState for the AgentCard when verifying / done
  const currentCard: CardState | null = (verifying || verifyResult || verifyError)
    ? (() => {
        let toolCall: ToolCallRequest | null = null
        try { toolCall = JSON.parse(parsedJson) as ToolCallRequest } catch { /* ok */ }
        return {
          id: 'sandbox-current',
          scenario: {
            tool_name: toolCall?.tool_name ?? '…',
            params: (toolCall?.params ?? {}) as Record<string, unknown>,
            agent_id: 'sandbox',
          },
          status: verifying ? 'verifying' : 'done',
          result: verifyResult ?? undefined,
          error: verifyError || undefined,
        } satisfies CardState
      })()
    : null

  return (
    <div className="panel-content">
      <div className="section-label">Describe a Financial Action</div>
      <textarea
        className="nl-textarea"
        placeholder="e.g. Buy 20,000 shares of NVDA with $400,000 capital available…"
        value={nlInput}
        onChange={(e) => setNlInput(e.target.value)}
        rows={3}
      />

      <button
        className="btn btn-primary"
        onClick={handleParse}
        disabled={parsing || !nlInput.trim()}
      >
        {parsing ? <span className="spinner" /> : null}
        {parsing ? ' Parsing…' : 'Parse →'}
      </button>

      {parseError && (
        <div className="compile-status compile-status-error">{parseError}</div>
      )}

      {parsedJson && (
        <>
          <div className="section-label">Tool Call (editable)</div>
          <textarea
            className="nl-textarea sandbox-json"
            value={parsedJson}
            onChange={(e) => setParsedJson(e.target.value)}
            spellCheck={false}
            rows={8}
          />

          <div className="sandbox-actions">
            <button
              className="btn btn-secondary"
              onClick={handleVerify}
              disabled={verifying || !parsedJson.trim()}
            >
              {verifying ? <span className="spinner" /> : null}
              {verifying ? ' Verifying…' : 'Verify →'}
            </button>

            {verifyResult && (
              <div className="sandbox-save-row">
                <input
                  className="sandbox-name-input"
                  placeholder="Scenario name (optional)"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                />
                <button className="btn btn-ghost btn-sm" onClick={handleSave}>
                  Save Scenario
                </button>
              </div>
            )}
          </div>

          {currentCard && (
            <div className="cards" style={{ marginTop: 8 }}>
              <AgentCard card={currentCard} />
            </div>
          )}
        </>
      )}

      {/* ── Saved scenarios ─────────────────────────────────────────────── */}
      {saved.length > 0 && (
        <>
          <div className="section-divider" style={{ marginTop: 8 }}>
            <span>saved scenarios</span>
          </div>
          <div className="saved-list">
            {saved.map((s) => {
              const runResult = runResults[s.id] ?? s.lastResult
              return (
                <div key={s.id} className="saved-item">
                  <div className="saved-item-header">
                    <span className="saved-item-name">{s.name}</span>
                    <div className="saved-item-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleRunSaved(s)}
                        disabled={runningId === s.id}
                      >
                        {runningId === s.id ? <span className="spinner" /> : '▶'}
                        {runningId === s.id ? ' Running…' : ' Run'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDeleteSaved(s.id)}
                        style={{ color: 'var(--red)' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="saved-item-call">
                    <span className="tool-name">{s.toolCall.tool_name}</span>
                    <span className="params-text">{JSON.stringify(s.toolCall.params)}</span>
                  </div>
                  {runResult && (
                    <div className="saved-verdict">
                      <span className={`verdict-badge verdict-${runResult.verdict}`}>
                        {runResult.verdict.toUpperCase()}
                      </span>
                      <span className="policy-label">{runResult.policy_id}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
