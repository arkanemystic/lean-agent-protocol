import { useEffect, useRef, useState } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const TITLE = "AXIOM PROTOCOL v1.0.0 — Formally Verified AI Guardrails"
const CHAR_DELAY_MS = 25 // ~40 chars/sec

type StatusLine =
  | { type: 'divider'; text: string }
  | { type: 'service'; service: string }

const STATUS_LINES: StatusLine[] = [
  { type: 'divider', text: '────────────────────────────────────────────────' },
  { type: 'service', service: '  Lean 4 kernel................... ' },
  { type: 'service', service: '  Policy environment.............. ' },
  { type: 'service', service: '  Orchestrator.................... ' },
  { type: 'service', service: '  WebSocket audit stream.......... ' },
  { type: 'service', service: '  Back-translator (Claude API).... ' },
  { type: 'divider', text: '────────────────────────────────────────────────' },
]

const ASCII_LOGO = [
  '█████╗ ██╗  ██╗██╗ ██████╗ ███╗   ███╗',
  '██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗ ████║',
  '███████║ ╚███╔╝ ██║██║   ██║██╔████╔██║',
  '██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╔╝██║',
  '██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚═╝ ██║',
  '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝',
]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the boot screen begins fading out — start showing main app now. */
  onFadeStart: () => void
  /** Called after fade completes — unmount BootScreen. */
  onDone: () => void
}

export function BootScreen({ onFadeStart, onDone }: Props) {
  const [started, setStarted] = useState(false)
  const [typedCount, setTypedCount] = useState(0)
  const [statusCount, setStatusCount] = useState(-1)
  const [showSummary, setShowSummary] = useState(false)
  const [showLogo, setShowLogo] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  // null = no typing yet (show instruction), string = user's typed input
  const [promptInput, setPromptInput] = useState<string | null>(null)
  const [showExitLine, setShowExitLine] = useState(false)
  const [fading, setFading] = useState(false)

  const exitTriggered = useRef(false)

  // ── Animation sequence ───────────────────────────────────────────────────

  // Step 2: Start typing after 300ms
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 300)
    return () => clearTimeout(t)
  }, [])

  // Char-by-char typing
  useEffect(() => {
    if (!started) return
    if (typedCount >= TITLE.length) {
      // Done typing → wait 200ms then start status lines
      const t = setTimeout(() => setStatusCount(0), 200)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setTypedCount((c) => c + 1), CHAR_DELAY_MS)
    return () => clearTimeout(t)
  }, [started, typedCount])

  // Status lines: one every 120ms
  useEffect(() => {
    if (statusCount < 0) return
    if (statusCount >= STATUS_LINES.length) {
      const t = setTimeout(() => setShowSummary(true), 200)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setStatusCount((c) => c + 1), 120)
    return () => clearTimeout(t)
  }, [statusCount])

  useEffect(() => {
    if (!showSummary) return
    const t = setTimeout(() => setShowLogo(true), 400)
    return () => clearTimeout(t)
  }, [showSummary])

  useEffect(() => {
    if (!showLogo) return
    const t = setTimeout(() => setShowPrompt(true), 600)
    return () => clearTimeout(t)
  }, [showLogo])

  // ── Exit ─────────────────────────────────────────────────────────────────

  function triggerExit() {
    if (exitTriggered.current) return
    exitTriggered.current = true
    setShowExitLine(true)
    setTimeout(() => {
      setFading(true)
      onFadeStart()
      setTimeout(() => onDone(), 400) // after CSS fade completes
    }, 300)
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!showPrompt) return
    const onKey = (e: KeyboardEvent) => {
      if (exitTriggered.current) return
      if (e.key === 'Enter') {
        triggerExit()
        return
      }
      if (e.key.length !== 1) return
      setPromptInput((prev) => {
        const next = (prev ?? '') + e.key
        if (next.toLowerCase().endsWith('enter')) {
          // Defer to avoid React batching issues
          setTimeout(triggerExit, 0)
        }
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showPrompt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`boot-screen${fading ? ' boot-fading' : ''}`}>
      <div className="boot-content">

        {/* Initial cursor before typing */}
        {!started && (
          <div className="boot-line">
            <span className="boot-cursor-inline" />
          </div>
        )}

        {/* Title: char by char */}
        {started && (
          <div className="boot-line">
            {TITLE.slice(0, typedCount)}
            {typedCount < TITLE.length && <span className="boot-cursor-inline" />}
          </div>
        )}

        {/* Status lines */}
        {STATUS_LINES.slice(0, statusCount).map((line, i) =>
          line.type === 'divider' ? (
            <div key={i} className="boot-line">{line.text}</div>
          ) : (
            <div key={i} className="boot-line">
              <span className="boot-blue">{line.service}</span>
              <span>[  OK  ]</span>
            </div>
          )
        )}

        {/* Summary line */}
        {showSummary && (
          <div className="boot-line boot-summary">
            All systems operational. Formal verification active.
          </div>
        )}

        {/* ASCII logo */}
        {showLogo && (
          <div className="boot-logo-wrap">
            <pre className="boot-logo">
              {ASCII_LOGO.join('\n')}
            </pre>
            <div className="boot-logo-subtitle boot-blue">
              P&nbsp;&nbsp;R&nbsp;&nbsp;O&nbsp;&nbsp;T&nbsp;&nbsp;O&nbsp;&nbsp;C&nbsp;&nbsp;O&nbsp;&nbsp;L
            </div>
          </div>
        )}

        {/* Prompt */}
        {showPrompt && (
          <div className="boot-prompt-area">
            {!showExitLine ? (
              <div className="boot-line boot-prompt-line">
                {'> '}
                {promptInput === null ? (
                  <>type &#39;enter&#39; to initialize<span className="boot-blink-cursor">_</span></>
                ) : (
                  <>{promptInput}<span className="boot-blink-cursor">_</span></>
                )}
              </div>
            ) : (
              <div className="boot-line">
                {'> Initializing Axiom Protocol...'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
