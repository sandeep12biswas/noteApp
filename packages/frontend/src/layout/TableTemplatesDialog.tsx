// "Manage templates…" (issue #38): preview, rename and delete table
// templates. Renaming or deleting never touches tables already in notes —
// those are independent copies (lib/tableTemplates.ts).
import { useEffect, useState } from 'react'
import type { TableTemplate } from '@flownote/ipc-adapter'
import { DEFAULT_HEADER_BACKGROUND, headerTextOn } from '../canvas/tableExtensions'
import { templateHeaders, templateSize } from '../lib/tableTemplates'
import { useTableTemplateStore } from '../store/tableTemplateStore'

function Preview({ template }: { template: TableTemplate }) {
  const { rows, cols } = templateSize(template.table)
  const headers = templateHeaders(template.table)
  const firstHeader = ((template.table as { content?: { content?: { attrs?: { background?: string | null } }[] }[] }).content?.[0]?.content?.[0]?.attrs?.background) || DEFAULT_HEADER_BACKGROUND
  return (
    <div className="flex flex-col gap-1">
      {headers.length > 0 && (
        <div className="flex overflow-hidden rounded-sm border border-lavender-300 text-[11px] font-bold" style={{ background: firstHeader, color: headerTextOn(firstHeader) }}>
          {headers.map((h, i) => (
            <span key={i} className="min-w-0 flex-1 truncate border-r border-white/30 px-1 py-0.5 last:border-r-0">
              {h || ' '}
            </span>
          ))}
        </div>
      )}
      <span className="text-[11px] text-gray-500 dark:text-gray-400">
        {rows} × {cols}
        {template.includesContents ? ' · with contents' : ''}
      </span>
    </div>
  )
}

function Row({ template }: { template: TableTemplate }) {
  const rename = useTableTemplateStore((s) => s.rename)
  const remove = useTableTemplateStore((s) => s.remove)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(template.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const commit = async () => {
    if (draft.trim() === template.name) return setEditing(false)
    const r = await rename(template.name, draft)
    if (r.ok) setEditing(false)
    else setError(r.error ?? 'Could not rename.')
  }

  return (
    <li className="flex flex-col gap-1 rounded border border-gray-200 p-2 dark:border-gray-700" aria-label={`Template ${template.name}`}>
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            autoFocus
            aria-label={`New name for ${template.name}`}
            value={draft}
            maxLength={80}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
                setDraft(template.name)
              }
            }}
            className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 dark:border-gray-700 dark:bg-gray-800"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{template.name}</span>
        )}
        {editing ? (
          <button type="button" className="text-xs text-lavender-600 hover:underline dark:text-lavender-300" onClick={() => void commit()}>
            Save
          </button>
        ) : (
          <button type="button" aria-label={`Rename ${template.name}`} className="text-xs text-lavender-600 hover:underline dark:text-lavender-300" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
        {confirmDelete ? (
          <>
            <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => void remove(template.name)}>
              Delete “{template.name}”?
            </button>
            <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" aria-label={`Delete ${template.name}`} className="text-xs text-red-600 hover:underline" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
      <Preview template={template} />
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  )
}

export function TableTemplatesDialog({ onClose }: { onClose: () => void }) {
  const templates = useTableTemplateStore((s) => s.templates)
  const load = useTableTemplateStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="Table templates"
        aria-modal="true"
        className="flex max-h-[80vh] w-[420px] flex-col gap-3 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Table templates</h2>
          <button type="button" aria-label="Close" className="rounded px-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onClose}>
            ✕
          </button>
        </div>
        {templates.length === 0 ? (
          <p className="text-xs text-gray-500">No templates yet. Put the cursor in a table and choose Insert ▸ Save as template….</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <Row key={t.name} template={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
