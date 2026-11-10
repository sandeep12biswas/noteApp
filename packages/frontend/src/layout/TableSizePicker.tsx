// Rows × columns picker for inserting a table (issue #37) — used by the
// ribbon's Insert ▸ Table button and the `/` menu's "Table…" item. Hover or
// arrow-key over the grid to size the table; click or Enter inserts it.
// Below the grid, saved templates (issue #38) insert a copy of that table.
// Escape or a click outside closes it.
import { useEffect, useRef, useState } from 'react'
import type { TableTemplate } from '@flownote/ipc-adapter'
import { templateSize } from '../lib/tableTemplates'
import { useTableTemplateStore } from '../store/tableTemplateStore'
import { useDismiss } from './ColorPickerMenu'

export const MAX_TABLE_ROWS = 8
export const MAX_TABLE_COLS = 8

export function TableSizePicker({
  x,
  y,
  onPick,
  onPickTemplate,
  onClose,
}: {
  x: number
  y: number
  onPick: (rows: number, cols: number) => void
  /** When given, saved templates are listed under the grid ("From template"). */
  onPickTemplate?: (template: TableTemplate) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ rows: 3, cols: 3 })
  const templates = useTableTemplateStore((s) => s.templates)
  const loadTemplates = useTableTemplateStore((s) => s.load)
  useDismiss(ref, onClose)

  useEffect(() => {
    if (onPickTemplate) void loadTemplates()
  }, [onPickTemplate, loadTemplates])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[data-rows="3"][data-cols="3"]')?.focus()
  }, [])

  const focusCell = (rows: number, cols: number) => {
    const r = Math.min(MAX_TABLE_ROWS, Math.max(1, rows))
    const c = Math.min(MAX_TABLE_COLS, Math.max(1, cols))
    setSize({ rows: r, cols: c })
    ref.current?.querySelector<HTMLButtonElement>(`[data-rows="${r}"][data-cols="${c}"]`)?.focus()
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Insert table"
      className="fixed z-50 rounded border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }
        const move = moves[e.key]
        if (move) {
          e.preventDefault()
          focusCell(size.rows + move[0], size.cols + move[1])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${MAX_TABLE_COLS}, 1rem)` }}>
        {Array.from({ length: MAX_TABLE_ROWS }, (_, r) =>
          Array.from({ length: MAX_TABLE_COLS }, (_, c) => {
            const on = r < size.rows && c < size.cols
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                data-rows={r + 1}
                data-cols={c + 1}
                aria-label={`${r + 1} by ${c + 1} table`}
                tabIndex={r + 1 === size.rows && c + 1 === size.cols ? 0 : -1}
                onMouseEnter={() => setSize({ rows: r + 1, cols: c + 1 })}
                onFocus={() => setSize({ rows: r + 1, cols: c + 1 })}
                onClick={() => onPick(r + 1, c + 1)}
                className={
                  'h-4 w-4 rounded-[2px] border outline-none focus-visible:ring-2 focus-visible:ring-lavender-600 ' +
                  (on ? 'border-lavender-600 bg-lavender-200 dark:bg-lavender-700' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800')
                }
              />
            )
          }),
        )}
      </div>
      <div className="mt-1.5 text-center text-xs text-gray-600 dark:text-gray-300" aria-live="polite">
        {size.rows} × {size.cols} table
      </div>
      {onPickTemplate && templates.length > 0 && (
        <div role="group" aria-label="From template" className="mt-2 border-t border-gray-100 pt-1.5 dark:border-gray-800">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">From template</div>
          <div className="flex max-h-40 flex-col overflow-y-auto">
            {templates.map((t) => {
              const { rows, cols } = templateSize(t.table)
              return (
                <button
                  key={t.name}
                  type="button"
                  aria-label={`Insert template ${t.name}`}
                  onClick={() => onPickTemplate(t)}
                  className="flex w-44 items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs text-gray-700 hover:bg-lavender-50 focus-visible:bg-lavender-50 focus-visible:outline-none dark:text-gray-200 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
                >
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {rows}×{cols}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
