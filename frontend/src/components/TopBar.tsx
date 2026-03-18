import { useEffect, useState } from 'react'
import type { WsStatus } from '../hooks/useAuditStream'

interface Props {
  wsStatus: WsStatus
}

function useClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  )
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

export function TopBar({ wsStatus }: Props) {
  const clock = useClock()

  const dotColor =
    wsStatus === 'connected'  ? 'var(--blue)' :
    wsStatus === 'connecting' ? 'var(--amber)' :
    'var(--muted)'

  const wsLabel =
    wsStatus === 'connected'  ? 'Live' :
    wsStatus === 'connecting' ? 'Connecting…' :
    'Disconnected'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-prompt">{'>'}</span>
        <span className="topbar-logo">
          <span className="topbar-logo-axiom">AXIOM</span>
          <span className="topbar-logo-protocol"> PROTOCOL</span>
        </span>
      </div>
      <div className="topbar-right">
        <span className="topbar-clock">{clock}</span>
        <span
          className={`ws-dot${wsStatus === 'connected' ? ' pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <span className="topbar-ws-label" style={{ color: dotColor }}>
          {wsLabel}
        </span>
      </div>
    </header>
  )
}
