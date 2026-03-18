import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { PolicyPanel } from './components/PolicyPanel'
import { AgentPanel } from './components/AgentPanel'
import { StatusPanel } from './components/StatusPanel'
import { AuditLog } from './components/AuditLog'
import { useAuditStream } from './hooks/useAuditStream'
import './App.css'

type Tab = 'policies' | 'agent' | 'status'

export default function App() {
  const [tab, setTab] = useState<Tab>('agent')
  const { entries, status: wsStatus } = useAuditStream()

  return (
    <div className="app">
      <TopBar wsStatus={wsStatus} />

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
              className={`tab-btn${tab === 'status' ? ' tab-active' : ''}`}
              onClick={() => setTab('status')}
            >
              Status
            </button>
          </div>

          <div className="tab-content">
            {tab === 'policies' && <PolicyPanel />}
            {tab === 'agent' && <AgentPanel />}
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
