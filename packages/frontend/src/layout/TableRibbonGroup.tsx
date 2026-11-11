// Insert ▸ Table (issue #37): a button that opens the rows × columns picker
// (and saved templates, #38), then the tools for the table the cursor is in
// — add/delete rows and columns, toggle the header row, header colour,
// row colours (TableRowColorMenu), delete table, save as template — and Manage templates…. The tools
// are disabled unless the cursor is inside a table.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { insertTable, DEFAULT_HEADER_BACKGROUND } from '../canvas/tableExtensions'
import { insertTemplateTable, tableAtSelection } from '../lib/tableTemplates'
import { useCanvasStore } from '../store/canvasStore'
import { ColorPickerMenu } from './ColorPickerMenu'
import { SaveTableTemplateDialog } from './SaveTableTemplateDialog'
import { TableRowColorMenu } from './TableRowColorMenu'
import { TableSizePicker } from './TableSizePicker'
import { TableTemplatesDialog } from './TableTemplatesDialog'

/** Background choices for the header row: FlowNote lavenders first, then a few strong colours and light neutrals. */
export const HEADER_COLORS = [
  '#7650c2', '#5f3da3', '#362463', '#a98de3', '#dcd0f6',
  '#1e40af', '#0f766e', '#15803d', '#b45309', '#b91c1c',
  '#374151', '#e5e7eb',
] as const

/** Whether the active segment's cursor is inside a table — rechecked whenever the selection or editor content changes. */
function useInTable(): boolean {
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const [inTable, setInTable] = useState(false)
  useEffect(() => {
    // `?.(`: test doubles of the editor may not implement isActive.
    const check = () => setInTable(!!getActiveEditor()?.isActive?.('table'))
    check()
    document.addEventListener('selectionchange', check)
    document.addEventListener('keyup', check)
    document.addEventListener('mouseup', check)
    return () => {
      document.removeEventListener('selectionchange', check)
      document.removeEventListener('keyup', check)
      document.removeEventListener('mouseup', check)
    }
  }, [getActiveEditor])
  return inTable
}

function ToolButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded-control px-1.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {children}
    </button>
  )
}

export function TableRibbonGroup() {
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const inTable = useInTable()
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState<JSONContent | null>(null)
  const [managing, setManaging] = useState(false)
  const insertRef = useRef<HTMLButtonElement | null>(null)
  const colorRef = useRef<HTMLButtonElement | null>(null)
  const rowColorRef = useRef<HTMLButtonElement | null>(null)

  const below = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect()
    return r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 }
  }
  const run = (fn: (chain: ReturnType<NonNullable<ReturnType<typeof getActiveEditor>>['chain']>) => { run: () => boolean }) => {
    const editor = getActiveEditor()
    if (editor) fn(editor.chain().focus()).run()
  }

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Table">
      <button
        ref={insertRef}
        type="button"
        aria-label="Insert table"
        title="Insert table"
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPicker(below(insertRef.current))}
        className="flex items-center gap-1 rounded-control px-1.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect x=".5" y=".5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" />
          <rect x="1" y="1" width="12" height="3.5" fill="#7650c2" />
          <path d="M.5 4.8h13M.5 9.2h13M5 .5v13M9.5.5v13" stroke="currentColor" strokeWidth=".8" />
        </svg>
        Table
      </button>
      <ToolButton label="Insert row above" disabled={!inTable} onClick={() => run((c) => c.addRowBefore())}>↥ Row</ToolButton>
      <ToolButton label="Insert row below" disabled={!inTable} onClick={() => run((c) => c.addRowAfter())}>↧ Row</ToolButton>
      <ToolButton label="Delete row" disabled={!inTable} onClick={() => run((c) => c.deleteRow())}>✕ Row</ToolButton>
      <ToolButton label="Insert column left" disabled={!inTable} onClick={() => run((c) => c.addColumnBefore())}>↤ Col</ToolButton>
      <ToolButton label="Insert column right" disabled={!inTable} onClick={() => run((c) => c.addColumnAfter())}>↦ Col</ToolButton>
      <ToolButton label="Delete column" disabled={!inTable} onClick={() => run((c) => c.deleteColumn())}>✕ Col</ToolButton>
      <ToolButton label="Header row on or off" disabled={!inTable} onClick={() => run((c) => c.toggleHeaderRow())}>Header</ToolButton>
      <button
        ref={colorRef}
        type="button"
        aria-label="Header colour"
        title="Header colour"
        aria-haspopup="menu"
        disabled={!inTable}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setColorMenu(below(colorRef.current))}
        className="flex items-center gap-1 rounded-control px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span className="inline-block h-3 w-3 rounded-handle border border-black/20" style={{ background: DEFAULT_HEADER_BACKGROUND }} />▾
      </button>
      <button
        ref={rowColorRef}
        type="button"
        aria-label="Row colours"
        title="Row colours"
        aria-haspopup="menu"
        disabled={!inTable}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setRowMenu(below(rowColorRef.current))}
        className="flex items-center gap-1 rounded-control px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span aria-hidden="true" className="inline-flex h-3 w-3 flex-col overflow-hidden rounded-handle border border-black/20">
          <span className="flex-1" style={{ background: '#f1edf9' }} />
          <span className="flex-1" style={{ background: '#e4dcf3' }} />
        </span>
        Rows ▾
      </button>
      <ToolButton label="Delete table" disabled={!inTable} onClick={() => run((c) => c.deleteTable())}>✕ Table</ToolButton>
      <ToolButton
        label="Save as template…"
        disabled={!inTable}
        onClick={() => {
          const editor = getActiveEditor()
          const table = editor ? tableAtSelection(editor) : null
          if (table) setSaving(table)
        }}
      >
        Save as template…
      </ToolButton>
      <ToolButton label="Manage templates…" onClick={() => setManaging(true)}>
        Templates…
      </ToolButton>

      {picker && (
        <TableSizePicker
          x={picker.x}
          y={picker.y}
          onPick={(rows, cols) => {
            const editor = getActiveEditor()
            if (editor) insertTable(editor, rows, cols)
            setPicker(null)
          }}
          onPickTemplate={(template) => {
            const editor = getActiveEditor()
            if (editor) insertTemplateTable(editor, template.table)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {colorMenu && (
        <ColorPickerMenu
          x={colorMenu.x}
          y={colorMenu.y}
          label="Header colour"
          colors={HEADER_COLORS}
          activeColor={DEFAULT_HEADER_BACKGROUND}
          onPick={(color) => run((c) => c.setTableHeaderColor(color))}
          onClear={() => run((c) => c.setTableHeaderColor(null))}
          onClose={() => setColorMenu(null)}
        />
      )}
      {rowMenu && getActiveEditor() && (
        <TableRowColorMenu x={rowMenu.x} y={rowMenu.y} editor={getActiveEditor()!} headerColors={HEADER_COLORS} onClose={() => setRowMenu(null)} />
      )}
      {saving && <SaveTableTemplateDialog table={saving} onClose={() => setSaving(null)} />}
      {managing && <TableTemplatesDialog onClose={() => setManaging(false)} />}
    </div>
  )
}
