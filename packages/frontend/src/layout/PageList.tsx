// File panel — DESIGN.md §5.2 (170px, title + auto-timestamp, active item
// 2px left border) and §2.2 (file list for the selected folder, search).
// New-page flow, filename validation/uniqueness, and search are a separate
// Phase 2 task — this is the chrome/slot.
export function PageList() {
  return (
    <section
      className="flex w-[170px] shrink-0 flex-col border-r border-gray-200 dark:border-gray-800"
      data-testid="page-list"
      aria-label="Pages"
    >
      <div className="flex-1 overflow-y-auto p-2 text-sm text-gray-400">
        {/* TODO: file list for the selected folder (DESIGN.md §2.2) */}
        No pages yet
      </div>
    </section>
  )
}
