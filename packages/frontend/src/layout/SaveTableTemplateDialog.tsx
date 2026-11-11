// "Save as template…" (issue #38): names the table the cursor is in and
// saves it app-wide. Warns before replacing a template of the same name.
import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { toTemplateTable } from '../lib/tableTemplates'
import { findByName, useTableTemplateStore } from '../store/tableTemplateStore'

export function SaveTableTemplateDialog({ table, onClose }: { table: JSONContent; onClose: () => void }) {
  const templates = useTableTemplateStore((s) => s.templates)
  const load = useTableTemplateStore((s) => s.load)
  const save = useTableTemplateStore((s) => s.save)
  const [name, setName] = useState('')
  const [includeContents, setIncludeContents] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void load()
    inputRef.current?.focus()
  }, [load])

  const existing = name.trim() ? findByName(templates, name) : undefined

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the template a name.')
      return
    }
    if (existing && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    const result = await save({ name, table: toTemplateTable(table, includeContents) as Record<string, unknown>, includesContents: includeContents })
    if (result.ok) onClose()
    else setError(result.error ?? 'Could not save the template.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-label="Save as template"
        aria-modal="true"
        className="flex w-[360px] flex-col gap-3 rounded-dialog border border-gray-200 bg-white p-4 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 className="text-base font-semibold">Save table as template</h2>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-300">Template name</span>
          <input
            ref={inputRef}
            aria-label="Template name"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value)
              setConfirmReplace(false)
              setError(null)
            }}
            className="rounded-control border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={includeContents} onChange={(e) => setIncludeContents(e.target.checked)} />
          Include cell contents
          <span className="text-gray-400">(otherwise only the layout and header row)</span>
        </label>
        {confirmReplace && existing && (
          <p role="alert" className="rounded-control bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            A template called “{existing.name}” already exists. Replace it?
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-control px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button type="submit" className="rounded-control bg-lavender-600 px-3 py-1 text-xs font-medium text-white hover:bg-lavender-700">
            {confirmReplace && existing ? 'Replace' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
