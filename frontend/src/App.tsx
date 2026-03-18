import { useEffect, useRef, useState } from 'react'
import { TopBar } from './components/TopBar'
import { PolicyPanel } from './components/PolicyPanel'
import { AgentPanel } from './components/AgentPanel'
import { StatusPanel } from './components/StatusPanel'
import { SandboxPanel } from './components/SandboxPanel'
import { AuditLog } from './components/AuditLog'
import { LogStream } from './components/LogStream'
import { BootScreen } from './components/BootScreen'
import { useAuditStream } from './hooks/useAuditStream'
import './App.css'

type Tab = 'policies' | 'agent' | 'status' | 'sandbox'

const TABS: { id: Tab; label: string; prefix: string }[] = [
  { id: 'policies', label: 'Policies', prefix: '0x01' },
  { id: 'agent',    label: 'Agent',    prefix: '0x02' },
  { id: 'sandbox',  label: 'Sandbox',  prefix: '0x03' },
  { id: 'status',   label: 'Status',   prefix: '0x04' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('agent')
  const { entries, status: wsStatus } = useAuditStream()
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Boot screen state — intentionally NOT persisted (every load shows boot)
  const [bootMounted, setBootMounted] = useState(true)
  const [appVisible, setAppVisible] = useState(false)

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  return (
    <>
      {/* Boot screen renders over everything until dismissed */}
      {bootMounted && (
        <BootScreen
          onFadeStart={() => setAppVisible(true)}
          onDone={() => setBootMounted(false)}
        />
      )}

      {/* Main app — fades in when boot starts fading out */}
      <div className={`app${appVisible ? ' app-visible' : ''}`}>
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
              {TABS.map(({ id, label, prefix }) => (
                <button
                  key={id}
                  className={`tab-btn${tab === id ? ' tab-active' : ''}`}
                  onClick={() => setTab(id)}
                >
                  <span className="tab-prefix">{prefix}</span>
                  {' '}{label}
                </button>
              ))}
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

            <LogStream />
          </div>

          {/* Divider */}
          <div className="panel-divider" />

          {/* Right panel */}
          <div className="right-panel">
            <AuditLog entries={entries} wsStatus={wsStatus} />
          </div>
        </div>
      </div>
    </>
  )
}
