// `/table <name>` (issue #38): templates whose name matches what's typed
// after "/table ", shown under the caret while typing. Like the "/" menu,
// focus stays in the editor — SegmentHost forwards ArrowUp/ArrowDown/
// Enter/Escape here — and a click picks a template too.
import type { TableTemplate } from '@flownote/ipc-adapter'
import { templateSize } from '../lib/tableTemplates'

export function TableTemplateMenu({
  x,
  y,
  query,
  matches,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: {
  x: number
  y: number
  query: string
  matches: readonly TableTemplate[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onSelect: (index: number) => void
}) {
  return (
    <div
      role="menu"
      aria-label="Table templates"
      className="fixed z-50 w-60 rounded-menu border border-gray-200 bg-white py-1 text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Insert table template</div>
      {matches.length === 0 ? (
        <div className="px-3 py-1.5 text-xs text-gray-500">No template matches “{query}”</div>
      ) : (
        matches.map((t, i) => {
          const { rows, cols } = templateSize(t.table)
          return (
            <button
              key={t.name}
              type="button"
              role="menuitem"
              data-active={i === activeIndex || undefined}
              onMouseEnter={() => onActiveIndexChange(i)}
              onClick={() => onSelect(i)}
              className={
                'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800' +
                (i === activeIndex ? ' bg-gray-100 dark:bg-gray-800' : '')
              }
            >
              <span className="truncate">{t.name}</span>
              <span className="shrink-0 text-[11px] text-gray-400">
                {rows}×{cols}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}
