// AI settings — add, edit, remove and choose the default AI provider
// (EXECUTION_PLAN.md Features — generic AI interface). Opened from the
// Insert tab's AI box. Requests are made by the backend; this dialog only
// ever *sends* an API key (and shows whether one is saved) — it can't read a
// saved key back.
import { type FormEvent, useEffect, useState } from 'react'
import type { AiProvider, AiProviderInput } from '@flownote/ipc-adapter'
import { AI_PRESETS, KIND_LABELS, useAIStore } from '../store/aiStore'

interface FormState {
  id: string
  /** Editing an existing provider (vs adding one). */
  existing: AiProvider | null
  kind: AiProviderInput['kind']
  name: string
  baseUrl: string
  model: string
  apiKey: string
  clearKey: boolean
  needsKey: boolean
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formFromPreset(index: number): FormState {
  const p = AI_PRESETS[index]!
  return { id: newId(), existing: null, kind: p.kind, name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: '', clearKey: false, needsKey: p.needsKey }
}

function formFromProvider(p: AiProvider): FormState {
  return { id: p.id, existing: p, kind: p.kind, name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: '', clearKey: false, needsKey: p.kind !== 'openai_compatible' }
}

const FIELD = 'w-full rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800'

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const providers = useAIStore((s) => s.providers)
  const loadError = useAIStore((s) => s.error)
  const load = useAIStore((s) => s.load)
  const save = useAIStore((s) => s.save)
  const remove = useAIStore((s) => s.remove)
  const setDefault = useAIStore((s) => s.setDefault)
  const [form, setForm] = useState<FormState | null>(null)
  const [presetIndex, setPresetIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    setError(null)
    if (!form.name.trim()) return setError('Give the provider a name.')
    const hasKeyAfterSave = form.apiKey.trim() !== '' || (form.existing?.hasApiKey === true && !form.clearKey)
    if (form.needsKey && form.kind !== 'openai_compatible' && !hasKeyAfterSave) {
      return setError(`${KIND_LABELS[form.kind]} needs an API key.`)
    }
    const input: AiProviderInput = { id: form.id, kind: form.kind, name: form.name, baseUrl: form.baseUrl, model: form.model }
    if (form.apiKey.trim()) input.apiKey = form.apiKey.trim()
    else if (form.clearKey) input.apiKey = null
    // Otherwise leave apiKey out: the saved key (if any) is kept.
    const result = await save(input)
    if (!result.ok) return setError(result.error ?? 'Could not save.')
    setForm(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="AI settings"
        aria-modal="true"
        className="flex max-h-[80vh] w-[460px] flex-col gap-3 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">AI providers</h2>
          <button type="button" aria-label="Close AI settings" onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            ✕
          </button>
        </div>

        {loadError && <p role="alert" className="text-xs text-red-600">{loadError}</p>}

        <ul aria-label="AI providers" className="flex flex-col gap-1">
          {providers.length === 0 && <li className="text-xs text-gray-400">No providers yet — add one below.</li>}
          {providers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 dark:border-gray-700">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.isDefault && <span className="rounded bg-blue-100 px-1 text-[10px] text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">Default</span>}
                </div>
                <div className="truncate text-[11px] text-gray-500">
                  {KIND_LABELS[p.kind]} · {p.model} · {p.hasApiKey ? 'key saved' : 'no key'}
                </div>
              </div>
              {!p.isDefault && (
                <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => void setDefault(p.id)} aria-label={`Make ${p.name} the default`}>
                  Make default
                </button>
              )}
              <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-300" onClick={() => setForm(formFromProvider(p))} aria-label={`Edit ${p.name}`}>
                Edit
              </button>
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void remove(p.id)} aria-label={`Remove ${p.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>

        {form ? (
          <form onSubmit={submit} aria-label={form.existing ? `Edit ${form.existing.name}` : 'Add AI provider'} className="flex flex-col gap-2 rounded border border-gray-200 p-3 dark:border-gray-700">
            {!form.existing && (
              <label className="flex flex-col gap-0.5 text-xs">
                Service
                <select
                  aria-label="Service"
                  className={FIELD}
                  value={presetIndex}
                  onChange={(e) => {
                    const i = Number(e.target.value)
                    setPresetIndex(i)
                    setForm(formFromPreset(i))
                  }}
                >
                  {AI_PRESETS.map((p, i) => (
                    <option key={p.label} value={i}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-0.5 text-xs">
              Name
              <input aria-label="Name" className={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Base URL
              <input aria-label="Base URL" className={FIELD} value={form.baseUrl} placeholder="Leave blank for the service's default" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Model
              <input aria-label="Model" className={FIELD} value={form.model} placeholder="Leave blank for the service's default" onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              API key{!form.needsKey && ' (if the service needs one)'}
              <input
                aria-label="API key"
                type="password"
                autoComplete="off"
                className={FIELD}
                value={form.apiKey}
                placeholder={form.existing?.hasApiKey ? 'Saved — leave blank to keep it' : ''}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
            </label>
            {form.existing?.hasApiKey && (
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={form.clearKey} onChange={(e) => setForm({ ...form, clearKey: e.target.checked })} />
                Remove the saved key
              </label>
            )}
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">
                Save
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="self-start rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            onClick={() => {
              setPresetIndex(0)
              setForm(formFromPreset(0))
            }}
          >
            Add provider
          </button>
        )}

        <p className="text-[11px] leading-snug text-gray-400">
          API keys are saved in FlowNote's database on this computer and used only by the app itself to make requests — they're never shown again or
          available to plugins. Anyone with a copy of the database file could read them.
        </p>
      </div>
    </div>
  )
}
