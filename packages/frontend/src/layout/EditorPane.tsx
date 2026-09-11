// Editor pane — DESIGN.md §5.2 (borderless 26px title, timestamp below,
// infinite segment canvas) and §2.3 (the canvas editor itself). Mounts
// `CanvasRoot` (DESIGN.md §4.1, §8.1) for the selected page/file once one is
// selected; otherwise shows the placeholder chrome.
import { useNotebookStore } from '../store/notebookStore'
import { CanvasRoot } from '../canvas/CanvasRoot'

export function EditorPane() {
  const selectedFileId = useNotebookStore((s) => s.selectedFileId)
  const file = useNotebookStore((s) => (s.selectedFileId ? s.files[s.selectedFileId] : undefined))

  return (
    <main className="flex flex-1 flex-col overflow-hidden" data-testid="editor-pane" aria-label="Editor">
      <div className="border-b border-gray-100 px-6 pt-4 pb-2 dark:border-gray-900">
        <h1 className="text-[26px] leading-tight font-normal text-gray-900 dark:text-gray-100">
          {file?.name ?? 'Untitled'}
        </h1>
        <p className="text-[11px] text-gray-400">
          {file ? new Date(file.updatedAt).toLocaleString() : 'No page selected'}
        </p>
      </div>
      <div className="relative flex-1 overflow-auto">
        {selectedFileId ? (
          <CanvasRoot pageId={selectedFileId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Select or create a page</div>
        )}
      </div>
    </main>
  )
}
