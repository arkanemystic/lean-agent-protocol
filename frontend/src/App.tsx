import { useEffect, useRef, useState } from 'react'
import { TopBar } from './components/TopBar'
import { PolicyPanel } from './components/PolicyPanel'
import { AgentPanel } from './components/AgentPanel'
import { StatusPanel } from './components/StatusPanel'
import { SandboxPanel } from './components/SandboxPanel'
import { AuditLog } from './components/AuditLog'
import { useAuditStream } from './hooks/useAuditStream'
import './App.css'

type Tab = 'policies' | 'agent' | 'status' | 'sandbox'

export default function App() {
  const [tab, setTab] = useState<Tab>('agent')
  const { entries, status: wsStatus } = useAuditStream()
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  return (
    <div className="app">
      <TopBar wsStatus={wsStatus} />

      {toast && (
        <div className="toast-bar">
          <span className="toast-msg">{toast}</span>
          <button className="toast-close" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      <div className="app-body">
        {/* Left panel */}
        <div className="left-panel">
          <div className="tab-bar">
            <button
              className={`tab-btn${tab === 'policies' ? ' tab-active' : ''}`}
              onClick={() => setTab('policies')}
            >
              Policies
            </button>
            <button
              className={`tab-btn${tab === 'agent' ? ' tab-active' : ''}`}
              onClick={() => setTab('agent')}
            >
              Agent
            </button>
            <button
              className={`tab-btn${tab === 'sandbox' ? ' tab-active' : ''}`}
              onClick={() => setTab('sandbox')}
            >
              Sandbox
            </button>
            <button
              className={`tab-btn${tab === 'status' ? ' tab-active' : ''}`}
              onClick={() => setTab('status')}
            >
              Status
            </button>
          </div>

          <div className="tab-content">
            {tab === 'policies' && (
              <PolicyPanel
                onDeployed={(id) =>
                  showToast(`Policy ${id} deployed — agent scenarios re-running`)
                }
              />
            )}
            {tab === 'agent' && <AgentPanel />}
            {tab === 'sandbox' && <SandboxPanel />}
            {tab === 'status' && <StatusPanel />}
          </div>
        </div>

        {/* Divider */}
        <div className="panel-divider" />

        {/* Right panel */}
        <div className="right-panel">
          <AuditLog entries={entries} wsStatus={wsStatus} />
        </div>
      </div>
    </div>
  )
}
