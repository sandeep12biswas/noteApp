// "/ Ask AI" prompt box (SegmentHost opens it from the `/` menu): a prompt
// input, a provider picker when more than one provider is set up, and
// Generate / Cancel. Enter generates, Escape cancels. With no backend or no
// provider it says so, and offers AI settings instead.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiSettingsDialog } from '../layout/AiSettingsDialog'
import { AI_NO_BACKEND } from '../lib/aiStream'
import { useAIStore } from '../store/aiStore'
import { getIPCAdapter } from '../store/notebookStore'

const BUTTON = 'rounded px-2 py-1 text-xs font-medium'

export function AiPromptPopover({
  x,
  y,
  initialPrompt = '',
  onGenerate,
  onCancel,
}: {
  x: number
  y: number
  initialPrompt?: string
  onGenerate: (prompt: string, providerId: string | undefined) => void
  onCancel: () => void
}) {
  const providers = useAIStore((s) => s.providers)
  const loaded = useAIStore((s) => s.loaded)
  const load = useAIStore((s) => s.load)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hasBackend = getIPCAdapter() !== null

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const chosen = providers.find((p) => p.id === providerId) ?? providers.find((p) => p.isDefault) ?? providers[0]
  const noProvider = hasBackend && loaded && providers.length === 0
  const canGenerate = hasBackend && !!chosen && prompt.trim().length > 0

  const generate = () => {
    if (canGenerate) onGenerate(prompt.trim(), chosen?.id)
  }

  return (
    <div
      role="dialog"
      aria-label="Ask AI"
      className="fixed z-50 w-80 rounded border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keys in the (portalled) settings dialog bubble here through React's tree — they're its own.
        if (e.key === 'Escape' && !settingsOpen) {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          aria-label="AI prompt for this segment"
          placeholder={chosen ? `Ask ${chosen.name}…` : 'Ask AI…'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              generate()
            }
          }}
          className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        {providers.length > 1 && (
          <select
            aria-label="AI provider for this segment"
            value={chosen?.id ?? ''}
            onChange={(e) => setProviderId(e.target.value)}
            className="max-w-[90px] rounded border border-gray-300 px-1 py-1 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {(!hasBackend || noProvider) && (
        <p role="status" className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {hasBackend ? 'No AI provider set up yet.' : AI_NO_BACKEND}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-1">
        {noProvider && (
          <button type="button" className={BUTTON + ' mr-auto text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-800'} onClick={() => setSettingsOpen(true)}>
            AI settings
          </button>
        )}
        <button type="button" className={BUTTON + ' text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canGenerate}
          className={BUTTON + ' bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40'}
          onClick={generate}
        >
          Generate
        </button>
      </div>
      {settingsOpen &&
        createPortal(
          // `data-ribbon`: focus moving into the dialog mustn't auto-delete
          // the (still empty) segment — SegmentHost's onBlur treats it like
          // the ribbon.
          <div data-ribbon="">
            <AiSettingsDialog
              onClose={() => {
                setSettingsOpen(false)
                void load()
                inputRef.current?.focus()
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
