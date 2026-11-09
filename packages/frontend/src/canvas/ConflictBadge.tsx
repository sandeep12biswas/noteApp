// Sync step S7: marks a conflict copy — a segment sync created because two
// devices edited the same text while out of touch (flownote_core::merge
// `make_conflict_copies`). Its id says so on every device
// (`segment-conflict-…`), so the badge needs no extra state.
const CONFLICT_PREFIX = 'segment-conflict-'

export function isConflictCopy(segmentId: string): boolean {
  return segmentId.startsWith(CONFLICT_PREFIX)
}

const HELP = 'Two devices edited this at the same time; this is the other version. Keep what you need and delete the rest.'

export function ConflictBadge({ segmentId, floating }: { segmentId: string; floating: boolean }) {
  if (!isConflictCopy(segmentId)) return null
  return (
    <span
      data-testid={`segment-${segmentId}-conflict-badge`}
      title={HELP}
      aria-label={`Conflict copy. ${HELP}`}
      contentEditable={false}
      // Not a place to start typing or dragging.
      onMouseDown={(e) => e.stopPropagation()}
      className={
        'select-none rounded bg-orange-100 px-1 text-[10px] font-medium text-orange-800 dark:bg-orange-900/50 dark:text-orange-200 ' +
        (floating ? 'absolute -top-2.5 right-1 z-10' : 'mb-0.5 inline-block')
      }
    >
      Conflict copy
    </span>
  )
}
