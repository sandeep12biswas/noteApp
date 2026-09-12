// Status bar — DESIGN.md §5.1 (~24px: word count · editing mode · draw mode indicator).
// The mode label is also Phase 5's mode-toggle control (DESIGN.md §4.3) — no
// dedicated ribbon button for it, since this is where DESIGN.md already
// says the current mode gets displayed.
import { useNotebookStore } from '../store/notebookStore'
import { ThemeToggle } from './ThemeToggle'

export function StatusBar() {
  const selectedFileId = useNotebookStore((s) => s.selectedFileId)
  const file = useNotebookStore((s) => (s.selectedFileId ? s.files[s.selectedFileId] : undefined))
  const setFileMode = useNotebookStore((s) => s.setFileMode)

  const mode = file?.mode ?? 'canvas'

  return (
    <footer
      className="flex h-6 shrink-0 items-center justify-end gap-4 border-t border-gray-200 px-3 text-[11px] text-gray-400 dark:border-gray-800"
      data-testid="status-bar"
    >
      <span>0 words</span>
      <ThemeToggle />
      {selectedFileId ? (
        <button
          type="button"
          aria-label={`Switch to ${mode === 'canvas' ? 'linear' : 'canvas'} mode`}
          onClick={() => setFileMode(selectedFileId, mode === 'canvas' ? 'linear' : 'canvas')}
          className="capitalize hover:text-gray-700 dark:hover:text-gray-200"
        >
          {mode}
        </button>
      ) : (
        <span>Canvas</span>
      )}
    </footer>
  )
}
