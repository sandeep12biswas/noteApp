// Folder/section sidebar — DESIGN.md §5.2 (160px, colour-coded vertical
// list, Plugins section at the bottom) and §2.1 (folder-only tree). The
// actual folder-tree behaviors (auto-capitalize, file counts, expand
// affordance, natural order, depth 7 default, icon picker) are a separate
// Phase 2 task — this component is the chrome/slot it lives in.
export function SectionSidebar() {
  return (
    <aside
      className="flex w-40 shrink-0 flex-col border-r border-gray-200 dark:border-gray-800"
      data-testid="section-sidebar"
      aria-label="Folders"
    >
      <div className="flex-1 overflow-y-auto p-2 text-sm text-gray-400">
        {/* TODO: folder tree (DESIGN.md §2.1) */}
        No folders yet
      </div>
      <div className="border-t border-gray-200 p-2 text-sm text-gray-400 dark:border-gray-800" data-testid="plugins-tab">
        {/* Plugins tab — DESIGN.md §9.5 Plugin Manager UI entry point */}
        Plugins
      </div>
    </aside>
  )
}
