// Status bar — DESIGN.md §5.1 (~24px: word count · editing mode · draw mode indicator).
export function StatusBar() {
  return (
    <footer
      className="flex h-6 shrink-0 items-center justify-end gap-4 border-t border-gray-200 px-3 text-[11px] text-gray-400 dark:border-gray-800"
      data-testid="status-bar"
    >
      <span>0 words</span>
      <span>Canvas</span>
    </footer>
  )
}
