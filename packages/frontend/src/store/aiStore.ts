// Configured AI providers (EXECUTION_PLAN.md Features — generic AI
// interface). The providers themselves — and their API keys — live in the
// backend (flownote_core::store, `ai_providers`); this store holds the
// listed copy for the AI box and the AI settings dialog. Keys are never in
// it: the backend only ever reports `hasApiKey`.
import { create } from 'zustand'
import type { AiProvider, AiProviderInput, AiProviderKind } from '@flownote/ipc-adapter'
import { getIPCAdapter } from './notebookStore'

/** Starting points for "Add provider" — every field stays editable. */
export interface AiPreset {
  label: string
  kind: AiProviderKind
  name: string
  baseUrl: string
  model: string
  /** Whether this service needs an API key (local servers usually don't). */
  needsKey: boolean
}

export const AI_PRESETS: AiPreset[] = [
  { label: 'Claude (Anthropic)', kind: 'anthropic', name: 'Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', needsKey: true },
  { label: 'Gemini (Google)', kind: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', needsKey: true },
  { label: 'OpenAI', kind: 'openai_compatible', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true },
  { label: 'Ollama (local)', kind: 'openai_compatible', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false },
  { label: 'Other OpenAI-compatible service', kind: 'openai_compatible', name: '', baseUrl: '', model: '', needsKey: false },
]

export const KIND_LABELS: Record<AiProviderKind, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai_compatible: 'OpenAI-compatible',
}

interface AIState {
  providers: AiProvider[]
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  save: (input: AiProviderInput) => Promise<{ ok: boolean; error?: string }>
  remove: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const useAIStore = create<AIState>((set, get) => ({
  providers: [],
  loaded: false,
  error: null,

  load: async () => {
    const ipc = getIPCAdapter()
    if (!ipc) return
    try {
      set({ providers: await ipc.listAiProviders(), loaded: true, error: null })
    } catch (err) {
      set({ loaded: true, error: message(err) })
    }
  },

  save: async (input) => {
    const ipc = getIPCAdapter()
    if (!ipc) return { ok: false, error: 'No backend connected.' }
    try {
      await ipc.saveAiProvider(input)
      await get().load()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  },

  remove: async (id) => {
    const ipc = getIPCAdapter()
    if (!ipc) return
    await ipc.deleteAiProvider(id)
    await get().load()
  },

  setDefault: async (id) => {
    const ipc = getIPCAdapter()
    if (!ipc) return
    await ipc.setDefaultAiProvider(id)
    await get().load()
  },
}))
