import { createContext, useContext, useReducer, type ReactNode } from 'react'
import type { FormalizePolicyResponse, GuardrailResultResponse } from '../types'

// ── State shapes ──────────────────────────────────────────────────────────────

interface PolicyEditorState {
  inputText: string
  formalizedLean: string | null
  policyId: string | null
  activeChip: string | null
  status: 'idle' | 'formalizing' | 'success' | 'error'
  error: string | null
  elapsedSeconds: number
}

interface PdfUploadState {
  filename: string | null
  results: FormalizePolicyResponse[]
  status: 'idle' | 'processing' | 'done'
  progress: string
  error: string
}

export interface SavedScenario {
  id: string
  name: string
  toolCall: { tool_name: string; params: Record<string, unknown>; agent_id?: string }
  lastResult?: GuardrailResultResponse
  savedAt: string
}

interface SandboxState {
  inputText: string
  parsedJson: string
  lastVerdict: GuardrailResultResponse | null
  savedScenarios: SavedScenario[]
}

export interface AppState {
  policyEditor: PolicyEditorState
  pdfUpload: PdfUploadState
  sandbox: SandboxState
}

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_POLICY_EDITOR'; payload: Partial<PolicyEditorState> }
  | { type: 'SET_PDF_UPLOAD'; payload: Partial<PdfUploadState> }
  | { type: 'SET_SANDBOX'; payload: Partial<SandboxState> }

// ── Initial state ─────────────────────────────────────────────────────────────

const initialState: AppState = {
  policyEditor: {
    inputText: '',
    formalizedLean: null,
    policyId: null,
    activeChip: null,
    status: 'idle',
    error: null,
    elapsedSeconds: 0,
  },
  pdfUpload: {
    filename: null,
    results: [],
    status: 'idle',
    progress: '',
    error: '',
  },
  sandbox: {
    inputText: '',
    parsedJson: '',
    lastVerdict: null,
    savedScenarios: (() => {
      try {
        return JSON.parse(localStorage.getItem('lean_agent_saved_scenarios') ?? '[]')
      } catch {
        return []
      }
    })(),
  },
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_POLICY_EDITOR':
      return { ...state, policyEditor: { ...state.policyEditor, ...action.payload } }
    case 'SET_PDF_UPLOAD':
      return { ...state, pdfUpload: { ...state.pdfUpload, ...action.payload } }
    case 'SET_SANDBOX': {
      const next = { ...state.sandbox, ...action.payload }
      // Sync savedScenarios to localStorage whenever it changes
      if (action.payload.savedScenarios !== undefined) {
        localStorage.setItem('lean_agent_saved_scenarios', JSON.stringify(next.savedScenarios))
      }
      return { ...state, sandbox: next }
    }
    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppState must be used inside AppContextProvider')
  return ctx
}
