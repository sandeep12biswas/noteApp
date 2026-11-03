// Editor pane — DESIGN.md §5.2 (borderless 26px title, timestamp below,
// infinite segment canvas) and §2.3 (the canvas editor itself). Mounts
// `CanvasRoot` (DESIGN.md §4.1, §8.1) for the selected page/file once one is
// selected; otherwise shows the placeholder chrome.
import { type KeyboardEvent, useEffect, useState } from 'react'
import { useNotebookStore } from '../store/notebookStore'
import { useUIStore } from '../store/uiStore'
import { CanvasRoot } from '../canvas/CanvasRoot'
import { InkLayer } from '../canvas/InkLayer'
import { LinearRoot } from '../canvas/LinearRoot'

/**
 * Borderless, editable page title (DESIGN.md §5.2) — commits on blur/Enter,
 * reverts on Escape, and re-syncs to the page list in real time since
 * `renameFile` writes straight into the shared `notebookStore` state that
 * `PageList` also reads.
 */
function PageTitle({ fileId, name }: { fileId: string; name: string }) {
  const renameFile = useNotebookStore((s) => s.renameFile)
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)

  // The selected file can change out from under this component (switching
  // pages keeps the same mounted <input> since EditorPane doesn't key on
  // fileId) — keep the draft in sync whenever the underlying name changes
  // from elsewhere (a fresh selection, or a remote/hydrated update).
  useEffect(() => {
    setValue(name)
    setError(null)
  }, [fileId, name])

  const commit = () => {
    if (value.trim() === name) {
      setValue(name)
      return
    }
    const result = renameFile(fileId, value)
    if (!result.ok) {
      setError(result.error ?? 'Could not rename page.')
      setValue(name)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      setValue(name)
      setError(null)
      e.currentTarget.blur()
    }
  }

  return (
    <div>
      <input
        aria-label="Page title"
        className="w-full border-none bg-transparent p-0 text-[26px] leading-tight font-normal text-gray-900 outline-none dark:text-gray-100"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function EditorPane() {
  const selectedFileId = useNotebookStore((s) => s.selectedFileId)
  const file = useNotebookStore((s) => (s.selectedFileId ? s.files[s.selectedFileId] : undefined))
  // Draw mode (DESIGN.md §5.5): the ink layer is inert everywhere except
  // the Draw ribbon tab, which is also where its Pen/Marker/Eraser tools
  // live (RibbonRoot).
  const drawMode = useUIStore((s) => s.activeRibbonTab === 'Draw')

  return (
    <main className="flex flex-1 flex-col overflow-hidden" data-testid="editor-pane" aria-label="Editor">
      <div className="border-b border-gray-100 px-6 pt-4 pb-2 dark:border-gray-900">
        {file ? (
          <PageTitle key={file.id} fileId={file.id} name={file.name} />
        ) : (
          <h1 className="text-[26px] leading-tight font-normal text-gray-900 dark:text-gray-100">Untitled</h1>
        )}
        <p className="text-[11px] text-gray-400">
          {file ? new Date(file.updatedAt).toLocaleString() : 'No page selected'}
        </p>
      </div>
      <div className="relative flex-1 overflow-auto">
        {selectedFileId && file ? (
          file.mode === 'linear' ? (
            <LinearRoot pageId={selectedFileId} />
          ) : (
            <>
              <CanvasRoot pageId={selectedFileId} />
              <InkLayer pageId={selectedFileId} active={drawMode} />
            </>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Select or create a page</div>
        )}
      </div>
    </main>
  )
}
