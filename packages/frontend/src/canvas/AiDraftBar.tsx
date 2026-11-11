// The bar under a segment holding an AI draft (aiDraftExtension.ts): Stop
// while the answer is arriving, then Keep / Discard / Try again. The
// shortcuts (Ctrl/Cmd+Enter, Escape) are handled in SegmentHost's editor
// key handler, since focus stays in the editor.
export type AiDraftStatus = 'streaming' | 'done' | 'stopped' | 'error'

const BUTTON = 'rounded-control px-2 py-0.5 text-xs font-medium'

export function AiDraftBar({
  status,
  error,
  onStop,
  onKeep,
  onDiscard,
  onRetry,
}: {
  status: AiDraftStatus
  error?: string
  onStop: () => void
  onKeep: () => void
  onDiscard: () => void
  onRetry: () => void
}) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <div
      role="toolbar"
      aria-label="AI draft"
      className="absolute top-full left-0 z-40 mt-1 flex items-center gap-1 rounded-menu border border-violet-200 bg-white px-1.5 py-1 shadow-sm dark:border-violet-900 dark:bg-gray-900 text-gray-900 dark:text-gray-100"
      // Keep focus (and the caret) in the editor, as the slash menu does.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {status === 'streaming' ? (
        <>
          <span role="status" className="px-1 text-xs text-violet-700 dark:text-violet-300">
            AI is writing…
          </span>
          <button type="button" className={BUTTON + ' text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'} onClick={onStop}>
            Stop
          </button>
        </>
      ) : (
        <>
          {status !== 'done' && (
            <span role="status" className="max-w-[220px] truncate px-1 text-xs text-gray-500 dark:text-gray-400" title={error}>
              {status === 'stopped' ? 'Stopped.' : error}
            </span>
          )}
          <button
            type="button"
            title={`Keep (${isMac ? '⌘' : 'Ctrl'}+Enter)`}
            className={BUTTON + ' bg-violet-600 text-white hover:bg-violet-700'}
            onClick={onKeep}
          >
            Keep
          </button>
          <button type="button" title="Discard (Esc)" className={BUTTON + ' text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'} onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className={BUTTON + ' text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'} onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </div>
  )
}
