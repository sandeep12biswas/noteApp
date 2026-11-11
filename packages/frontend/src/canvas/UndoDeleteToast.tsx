// "Segment deleted · Undo" toast (issue #29). Shown while a segment removed
// with "Delete segment" can still be restored (canvasStore's
// `recentlyDeleted`, open for UNDO_DELETE_MS). Undo — or Ctrl/Cmd+Z while
// focus isn't in a text field — brings it back; ✕ makes the deletion final
// at once.
import { useEffect } from 'react'
import { useCanvasStore, UNDO_DELETE_MS } from '../store/canvasStore'

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null)
}

export function UndoDeleteToast() {
  const deleted = useCanvasStore((s) => s.recentlyDeleted)
  const undo = useCanvasStore((s) => s.undoDeleteSegment)
  const commit = useCanvasStore((s) => s.commitDeleteSegment)

  useEffect(() => {
    if (!deleted) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Inside an editor, Ctrl+Z is that editor's own text undo.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target)) {
        e.preventDefault()
        undo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [deleted, undo])

  if (!deleted) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-delete-toast"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 overflow-hidden rounded-menu bg-gray-900 py-2 pr-2 pl-4 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
    >
      <span>Segment deleted</span>
      <button
        type="button"
        onClick={undo}
        className="rounded-control px-2 py-1 font-medium text-lavender-300 hover:bg-white/10 dark:text-lavender-700 dark:hover:bg-black/10"
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={commit}
        className="rounded-control px-1.5 py-1 text-gray-400 hover:bg-white/10 hover:text-white dark:text-gray-500 dark:hover:bg-black/10 dark:hover:text-gray-900"
      >
        ✕
      </button>
      {/* Time left to undo; keyed so a new deletion restarts it. */}
      <span
        key={deleted.id}
        aria-hidden
        className="undo-toast-timer absolute bottom-0 left-0 h-0.5 w-full origin-left bg-lavender-400 dark:bg-lavender-600"
        style={{ animationDuration: `${UNDO_DELETE_MS}ms` }}
      />
    </div>
  )
}
