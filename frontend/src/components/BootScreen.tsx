import { useEffect, useRef, useState } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPING_TEXT = "INITIALIZING SECURE EXECUTION ENVIRONMENT..."
const CHAR_DELAY_MS = Math.round(1000 / 60) // ~60 chars/sec

const BOOT_LINES = [
  { tag: '[BOOT]', desc: 'Loading Lean 4 verification kernel' },
  { tag: '[BOOT]', desc: 'Compiling policy axiom environment' },
  { tag: '[BOOT]', desc: 'Establishing formal proof context' },
  { tag: '[BOOT]', desc: 'Mounting WebSocket audit stream' },
  { tag: '[BOOT]', desc: 'Connecting to Aristotle theorem prover' },
  { tag: '[BOOT]', desc: 'Initializing back-translation pipeline' },
]

const EXIT_LINES = [
  '>> kernel.ready',
  '>> policies.compiled',
  '>> orchestrator.active',
  '>> audit.stream.open',
  '>> launch',
]

const ASCII_LOGO = [
  '█████╗ ██╗  ██╗██╗ ██████╗ ███╗   ███╗',
  '██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗ ████║',
  '███████║ ╚███╔╝ ██║██║   ██║██╔████╔██║',
  '██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╔╝██║',
  '██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚═╝ ██║',
  '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝',
]

type Phase = 'init' | 'typing' | 'bootlines' | 'progress' | 'rule' | 'logo' | 'btn'

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onFadeStart: () => void
  onDone: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BootScreen({ onFadeStart, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('init')
  const [typedCount, setTypedCount] = useState(0)
  const [bootLineCount, setBootLineCount] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [exitLines, setExitLines] = useState<string[]>([])
  const [flickering, setFlickering] = useState(false)
  const [fading, setFading] = useState(false)
  const exitTriggered = useRef(false)

  // ── Animation sequence ───────────────────────────────────────────────────

  // Step 1: 500ms black pause, then start typing
  useEffect(() => {
    const t = setTimeout(() => setPhase('typing'), 500)
    return () => clearTimeout(t)
  }, [])

  // Step 2: char-by-char typing
  useEffect(() => {
    if (phase !== 'typing') return
    if (typedCount >= TYPING_TEXT.length) {
      const t = setTimeout(() => setPhase('bootlines'), 200)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setTypedCount((c) => c + 1), CHAR_DELAY_MS)
    return () => clearTimeout(t)
  }, [phase, typedCount])

  // Step 3: boot lines, 80ms each
  useEffect(() => {
    if (phase !== 'bootlines') return
    if (bootLineCount >= BOOT_LINES.length) {
      const t = setTimeout(() => setPhase('progress'), 150)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setBootLineCount((c) => c + 1), 80)
    return () => clearTimeout(t)
  }, [phase, bootLineCount])

  // Step 4 → 5 → 6 → 7
  useEffect(() => {
    if (phase !== 'progress') return
    const t = setTimeout(() => setPhase('rule'), 300)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'rule') return
    const t = setTimeout(() => setPhase('logo'), 200)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'logo') return
    const t = setTimeout(() => setPhase('btn'), 400)
    return () => clearTimeout(t)
  }, [phase])

  // ── Exit sequence ────────────────────────────────────────────────────────

  async function handleLaunch() {
    if (exitTriggered.current) return
    exitTriggered.current = true
    setLaunching(true)

    for (const line of EXIT_LINES) {
      await sleep(60)
      setExitLines((prev) => [...prev, line])
    }

    await sleep(200)

    // Flicker: single opacity drop
    setFlickering(true)
    await sleep(50)
    setFlickering(false)
    await sleep(50)

    setFading(true)
    onFadeStart()
    setTimeout(() => onDone(), 500)
  }

  // ── Derived render flags ──────────────────────────────────────────────────

  const atOrPast = (p: Phase) => {
    const order: Phase[] = ['init', 'typing', 'bootlines', 'progress', 'rule', 'logo', 'btn']
    return order.indexOf(phase) >= order.indexOf(p)
  }

  const showProgress = atOrPast('progress') || launching
  const showRule     = atOrPast('rule') || launching
  const showLogo     = atOrPast('logo') || launching
  const showBtn      = atOrPast('btn')

  let screenClass = 'boot-screen'
  if (fading) screenClass += ' boot-fading'
  if (flickering) screenClass += ' boot-flickering'

  return (
    <div className={screenClass}>
      <div className="boot-content">

        {/* Step 1: initial cursor */}
        {phase === 'init' && (
          <div className="boot-line">
            <span className="boot-cursor-inline" />
          </div>
        )}

        {/* Step 2: typing line */}
        {phase !== 'init' && (
          <div className="boot-line">
            {TYPING_TEXT.slice(0, typedCount)}
            {phase === 'typing' && typedCount < TYPING_TEXT.length && (
              <span className="boot-cursor-inline" />
            )}
          </div>
        )}

        {/* Step 3: boot lines */}
        {BOOT_LINES.slice(0, bootLineCount).map((line, i) => (
          <div key={i} className="boot-line boot-line-sm">
            <span className="boot-blue">{'  ' + line.tag + ' '}</span>
            <span className="boot-muted">{line.desc}</span>
          </div>
        ))}

        {/* Step 4: progress bar + summary */}
        {showProgress && (
          <>
            <div className="boot-line boot-line-sm">&nbsp;</div>
            <div className="boot-line boot-line-sm">
              {'  '}<span className="boot-progress-bar">{'████████████████████████████████'}</span>
              <span className="boot-progress-pct">{'  100%'}</span>
            </div>
            <div className="boot-line boot-line-sm">{'  All subsystems nominal.'}</div>
          </>
        )}

        {/* Step 5: subtle rule */}
        {showRule && (
          <div className="boot-rule">────────────────────────────────────────────────</div>
        )}

        {/* Step 6: ASCII logo with CSS scanline */}
        {showLogo && (
          <div className="boot-logo-wrap">
            <pre className="boot-logo">{ASCII_LOGO.join('\n')}</pre>
            <div className="boot-logo-subtitle boot-blue">
              P&nbsp;&nbsp;R&nbsp;&nbsp;O&nbsp;&nbsp;T&nbsp;&nbsp;O&nbsp;&nbsp;C&nbsp;&nbsp;O&nbsp;&nbsp;L
            </div>
          </div>
        )}

        {/* Step 7: button + exit lines */}
        {showBtn && (
          <div className="boot-btn-area">
            <div className="boot-status-text">
              Formal verification active — 3 policies loaded
            </div>
            <button
              className={`boot-btn${launching ? ' boot-btn-launching' : ''}`}
              onClick={handleLaunch}
              disabled={launching}
            >
              {launching ? '> LAUNCHING...' : '> INITIALIZE AXIOM PROTOCOL'}
            </button>
            {exitLines.map((line, i) => (
              <div key={i} className="boot-exit-line">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
