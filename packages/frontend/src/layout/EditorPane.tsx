// Editor pane — DESIGN.md §5.2 (borderless 26px title, timestamp below,
// infinite segment canvas) and §2.3 (the canvas editor itself). CanvasRoot/
// SegmentHost/TipTap wiring is the dedicated Phase 2 "CanvasRoot +
// SegmentHost" task — this is the chrome/slot it mounts into.
export function EditorPane() {
  return (
    <main className="flex flex-1 flex-col overflow-hidden" data-testid="editor-pane" aria-label="Editor">
      <div className="border-b border-gray-100 px-6 pt-4 pb-2 dark:border-gray-900">
        <h1 className="text-[26px] leading-tight font-normal text-gray-900 dark:text-gray-100">Untitled</h1>
        <p className="text-[11px] text-gray-400">No page selected</p>
      </div>
      <div className="relative flex-1 overflow-auto">
        {/* TODO: CanvasRoot / SegmentHost (DESIGN.md §4.1, §8.1) */}
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          Click anywhere to start writing
        </div>
      </div>
    </main>
  )
}
