// Insert ▸ Row colours (table row shading): how the body rows of the table
// the cursor is in are coloured.
//
//   - All rows: the banding colour. The rows alternate between the lightest
//     tint of it and one shade darker (canvas/tableExtensions.ts
//     rowShading). By default the bands follow the header colour; "Match
//     header" goes back to that, "No shading" turns the bands off.
//   - This row: one row (or every row of a cell selection) in a colour of
//     its own, over the bands; "Use table shading" removes it.
//
// Same popover and "Apply to" switch as the Page colour menu.
import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { NO_ROW_SHADING, tableHeaderColor } from '../canvas/tableExtensions'
import { COLOR_SHADES, SHADE_NAMES } from '../lib/colorShades'
import { useRecentRowColors } from '../lib/recentColors'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { ColorPalette } from './ColorPalette'
import { CustomColorInput, MENU_TEXT_BUTTON_CLASSNAME, POPOVER_CLASSNAME, SwatchGrid, useClampToViewport, useDismiss } from './ColorPickerMenu'

const SECTION_HEADING = 'px-0.5 text-[10px] font-medium text-gray-500 uppercase dark:text-gray-400'

type Target = 'all' | 'row'
const TARGET_LABEL: Record<Target, string> = { all: 'All rows', row: 'This row' }

/** Light colours for a single row: the "lighter" step of every hue. */
const ROW_PRESETS = COLOR_SHADES.map((hue) => ({ name: `Light ${hue.name.toLowerCase()}`, color: hue.shades[SHADE_NAMES.indexOf('lighter')]! }))

/** The current settings of the table (and row) around the editor's selection. */
export function rowColorsAtSelection(editor: Editor): { shading: string | null; headerColor: string; row: string | null } | null {
  const { $from } = editor.state.selection
  let row: string | null = null
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'tableRow') row = (node.attrs.background as string | null) ?? null
    if (node.type.name === 'table') {
      return { shading: (node.attrs.rowColors as string | null) ?? null, headerColor: tableHeaderColor(node), row }
    }
  }
  return null
}

/** The two band tints of `color`, as the table draws them in the light theme. */
function BandPreview({ color }: { color: string | null }) {
  if (!color) return <div className="h-7 rounded-control border border-dashed border-gray-300 text-center text-[10px] leading-7 text-gray-400 dark:border-gray-600">No shading</div>
  return (
    <div aria-hidden="true" className="flex flex-col overflow-hidden rounded-control border border-black/10">
      <div className="h-3.5" style={{ background: `color-mix(in srgb, ${color} 10%, white)` }} />
      <div className="h-3.5" style={{ background: `color-mix(in srgb, ${color} 20%, white)` }} />
    </div>
  )
}

export function TableRowColorMenu({
  x,
  y,
  editor,
  headerColors,
  onClose,
}: {
  x: number
  y: number
  editor: Editor
  /** The header colour choices, offered as banding colours too. */
  headerColors: readonly string[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref)
  useDismiss(ref, onClose)
  useClampToViewport(ref, x, y)
  const recent = useRecentRowColors((s) => s.colors)
  const addRecent = useRecentRowColors((s) => s.add)
  const [target, setTarget] = useState<Target>('all')
  // The settings are read from the editor, not React state: re-render after a
  // change made while the menu stays open (the Custom… colour input).
  const [, refresh] = useState(0)
  const current = rowColorsAtSelection(editor)
  if (!current) return null

  const bandColor = current.shading === NO_ROW_SHADING ? null : (current.shading ?? current.headerColor)
  const setShading = (color: string | null) => {
    editor.chain().focus().setTableRowShading(color).run()
    refresh((n) => n + 1)
  }
  const setRow = (color: string | null) => {
    editor.chain().focus().setTableRowColor(color).run()
    refresh((n) => n + 1)
  }
  const done = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Row colours"
      className={POPOVER_CLASSNAME + ' w-64'}
      style={{ left: x, top: y, maxHeight: `calc(100vh - ${y + 8}px)`, overflowY: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div role="group" aria-label="Apply to" className="flex flex-col gap-1">
        <span className={SECTION_HEADING}>Apply to</span>
        <div className="grid grid-cols-2 gap-0.5 rounded-control bg-gray-100 p-0.5 dark:bg-gray-800">
          {(['all', 'row'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={target === t}
              onClick={() => setTarget(t)}
              className={
                'rounded-control px-2 py-1 text-xs ' +
                (target === t
                  ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100')
              }
            >
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {target === 'all' ? (
        <>
          <span className={SECTION_HEADING}>Alternating rows</span>
          <BandPreview color={bandColor} />
          <SwatchGrid label="Row shading" colors={headerColors} activeColor={current.shading === NO_ROW_SHADING ? null : current.shading} onPick={(c) => done(() => setShading(c))()} />
          <CustomColorInput label="Custom row shading" value={bandColor ?? current.headerColor} onPick={setShading} />
          <div className="flex flex-col">
            <button type="button" role="menuitem" disabled={current.shading === null} onClick={done(() => setShading(null))} className={MENU_TEXT_BUTTON_CLASSNAME + ' disabled:opacity-40'}>
              Match header colour
            </button>
            <button type="button" role="menuitem" disabled={current.shading === NO_ROW_SHADING} onClick={done(() => setShading(NO_ROW_SHADING))} className={MENU_TEXT_BUTTON_CLASSNAME + ' disabled:opacity-40'}>
              No shading
            </button>
          </div>
        </>
      ) : (
        <ColorPalette
          label="This row"
          presetsHeading="Light"
          presets={ROW_PRESETS}
          hues={COLOR_SHADES}
          shadeNames={SHADE_NAMES}
          recent={recent}
          activeColor={current.row}
          wheelInitialColor={bandColor ?? current.headerColor}
          onPick={(c) => done(() => setRow(c))()}
          onWheelPick={(c) => {
            addRecent(c)
            done(() => setRow(c))()
          }}
          footer={
            <button type="button" role="menuitem" disabled={current.row === null} onClick={done(() => setRow(null))} className={MENU_TEXT_BUTTON_CLASSNAME + ' disabled:opacity-40'}>
              Use table shading
            </button>
          }
        />
      )}
    </div>
  )
}
