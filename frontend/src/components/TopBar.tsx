import type { WsStatus } from '../hooks/useAuditStream'

interface Props {
  wsStatus: WsStatus
}

export function TopBar({ wsStatus }: Props) {
  const dotColor =
    wsStatus === 'connected' ? 'var(--blue)' :
    wsStatus === 'connecting' ? 'var(--amber)' :
    'var(--muted)'

  const label =
    wsStatus === 'connected' ? 'Live' :
    wsStatus === 'connecting' ? 'Connecting…' :
    'Disconnected'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-logo">⊢</span>
        <span className="topbar-title">Lean-Agent Protocol</span>
        <span className="topbar-subtitle">Formally verified AI guardrails</span>
      </div>
      <div className="topbar-right">
        <span
          className={`ws-dot${wsStatus === 'connected' ? ' pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <span className="topbar-ws-label" style={{ color: dotColor }}>
          {label}
        </span>
      </div>
    </header>
  )
}
