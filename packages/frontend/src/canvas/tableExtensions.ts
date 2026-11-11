// Tables (issue #37): TipTap's table nodes, plus a coloured header row.
//
// Header cells (`tableHeader`, i.e. <th>) carry a `background` colour —
// null means the default, FlowNote lavender — and always render with a
// text colour picked for contrast against it (WCAG AA, 4.5:1), so a header
// stays readable whatever colour it's given, in light and dark themes.
// Body cells keep the editor's normal text colour (index.css).
//
// Row shading: the body rows are banded in tints of the header colour —
// the row right under the header gets the lightest tint, the next one a
// shade darker, and so on alternately. The table's `rowColors` attribute
// picks the banding colour: null follows the header, a colour bands in
// that colour instead, 'none' turns the shading off. A single row can be
// given its own colour (`tableRow.background`), which wins over the band,
// with text picked for contrast like the header's. The shading is drawn by
// decorations (rowShadingPlugin), so it follows header-colour changes and
// added/removed rows without rewriting the document.
//
// Part of segmentEditorExtensions, so tables load in canvas and linear
// mode alike and are saved with the segment's content like anything else.
import { Extension, type CommandProps, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { contrastRatio, CONTRAST_TEXT, readableTextOn } from '../lib/textColors'

/** lavender-600 (index.css @theme). */
export const DEFAULT_HEADER_BACKGROUND = '#7650c2'

/** Text colour for a header cell: the app's usual dark/light ink, or pure black/white when that isn't quite 4.5:1 on this background. */
export function headerTextOn(background: string): string {
  const preferred = readableTextOn(background)
  if (preferred && contrastRatio(background, preferred) >= CONTRAST_TEXT) return preferred
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff'
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableHeaderColor: {
      /** Sets the background of every header cell in the table around the selection (null = default lavender). */
      setTableHeaderColor: (color: string | null) => ReturnType
    }
    tableRowShading: {
      /** Banding colour for the body rows of the table around the selection: null = follow the header colour, 'none' = no shading. */
      setTableRowShading: (color: string | null) => ReturnType
      /** Gives the row(s) around the selection their own background (null = back to the table's shading). */
      setTableRowColor: (color: string | null) => ReturnType
    }
  }
}

/** `rowColors` value that turns the banding off. */
export const NO_ROW_SHADING = 'none'

/** How one row of a table is shaded. */
export type RowShade =
  | { kind: 'header' }
  | { kind: 'plain' }
  /** `band` 1 is the lightest tint (first body row), 2 a shade darker, alternating. */
  | { kind: 'band'; band: 1 | 2; color: string }
  | { kind: 'custom'; color: string; text: string }

/** A header row: every cell is a header cell (a header *column* doesn't make the row a header). */
function isHeaderRow(row: PMNode): boolean {
  return row.childCount > 0 && Array.from({ length: row.childCount }, (_, i) => row.child(i)).every((c) => c.type.name === 'tableHeader')
}

/** The colour of the table's header row (its first header cell's), or the default lavender. */
export function tableHeaderColor(table: PMNode): string {
  for (let r = 0; r < table.childCount; r++) {
    const row = table.child(r)
    if (!isHeaderRow(row)) continue
    return (row.child(0).attrs.background as string | null) || DEFAULT_HEADER_BACKGROUND
  }
  return DEFAULT_HEADER_BACKGROUND
}

/** The shading of each row of `table`, top to bottom. */
export function rowShading(table: PMNode): RowShade[] {
  const setting = (table.attrs.rowColors as string | null) ?? null
  const bandColor = setting === NO_ROW_SHADING ? null : (setting ?? tableHeaderColor(table))
  const shades: RowShade[] = []
  let body = 0
  for (let r = 0; r < table.childCount; r++) {
    const row = table.child(r)
    if (isHeaderRow(row)) {
      shades.push({ kind: 'header' })
      continue
    }
    const own = row.attrs.background as string | null
    if (own) shades.push({ kind: 'custom', color: own, text: headerTextOn(own) })
    else if (bandColor) shades.push({ kind: 'band', band: body % 2 === 0 ? 1 : 2, color: bandColor })
    else shades.push({ kind: 'plain' })
    body++
  }
  return shades
}

function shadingDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    const shades = rowShading(node)
    let rowPos = pos + 1
    node.forEach((row, _offset, index) => {
      const shade = shades[index]!
      if (shade.kind === 'band') {
        decorations.push(Decoration.node(rowPos, rowPos + row.nodeSize, { 'data-band': String(shade.band), style: `--band: ${shade.color}` }))
      } else if (shade.kind === 'custom') {
        decorations.push(Decoration.node(rowPos, rowPos + row.nodeSize, { 'data-row-color': '', style: `--row-bg: ${shade.color}; --row-fg: ${shade.text}` }))
      }
      rowPos += row.nodeSize
    })
    return false
  })
  return DecorationSet.create(doc, decorations)
}

const rowShadingKey = new PluginKey<DecorationSet>('tableRowShading')

const rowShadingPlugin = new Plugin<DecorationSet>({
  key: rowShadingKey,
  state: {
    init: (_config, state: EditorState) => shadingDecorations(state.doc),
    apply: (tr: Transaction, old: DecorationSet) => (tr.docChanged ? shadingDecorations(tr.doc) : old),
  },
  props: {
    decorations: (state) => rowShadingKey.getState(state),
  },
})

/** Position and node of the table around the selection, or null. */
function tableAround(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return { pos: $from.before(depth), node }
  }
  return null
}

/** Positions of the rows the selection is in: every row of a cell selection, else the cursor's row. */
function rowsAround(state: EditorState): number[] {
  const { selection } = state
  const rows = new Set<number>()
  if (selection instanceof CellSelection) {
    selection.forEachCell((_cell, cellPos) => rows.add(state.doc.resolve(cellPos).before()))
  } else {
    const { $from } = selection
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'tableRow') {
        rows.add($from.before(depth))
        break
      }
    }
  }
  return [...rows]
}

const ShadedTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowColors: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-row-colors') || null,
        renderHTML: (attrs: { rowColors?: string | null }) => (attrs.rowColors ? { 'data-row-colors': attrs.rowColors } : {}),
      },
    }
  },
})

const ColoredTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      background: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-background') || null,
        renderHTML: (attrs: { background?: string | null }) => (attrs.background ? { 'data-background': attrs.background } : {}),
      },
    }
  },
})

const TableRowShading = Extension.create({
  name: 'tableRowShading',
  addProseMirrorPlugins() {
    return [rowShadingPlugin]
  },
  addCommands() {
    return {
      setTableRowShading:
        (color: string | null) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const table = tableAround(state)
          if (!table) return false
          if (dispatch) dispatch(tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, rowColors: color }))
          return true
        },
      setTableRowColor:
        (color: string | null) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const rows = rowsAround(state)
          if (rows.length === 0) return false
          if (dispatch) {
            for (const pos of rows) {
              const row = tr.doc.nodeAt(pos)
              if (row) tr.setNodeMarkup(pos, undefined, { ...row.attrs, background: color })
            }
            dispatch(tr)
          }
          return true
        },
    }
  },
})

const ColoredTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      background: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-background') || null,
        renderHTML: (attrs: { background?: string | null }) => {
          const background = attrs.background || DEFAULT_HEADER_BACKGROUND
          return {
            ...(attrs.background ? { 'data-background': attrs.background } : {}),
            style: `background-color: ${background}; color: ${headerTextOn(background)}`,
          }
        },
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTableHeaderColor:
        (color: string | null) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const { $from } = state.selection
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth)
            if (node.type.name !== 'table') continue
            const tableStart = $from.before(depth) + 1
            let changed = false
            node.descendants((child, pos) => {
              if (child.type.name === 'tableHeader') {
                tr.setNodeMarkup(tableStart + pos, undefined, { ...child.attrs, background: color })
                changed = true
              }
              return child.type.name !== 'tableHeader'
            })
            if (changed && dispatch) dispatch(tr)
            return changed
          }
          return false
        },
    }
  },
})

export const tableExtensions = [
  // Resizable columns: widths are stored on the cells (`colwidth`), so they're saved with the page.
  ShadedTable.configure({ resizable: true, lastColumnResizable: false, HTMLAttributes: { class: 'flownote-table' } }),
  ColoredTableRow,
  ColoredTableHeader,
  TableCell,
  TableRowShading,
]

/**
 * Gives DOM focus back to the editor right away. The table picker had focus,
 * and TipTap's `focus()` command only restores it a frame later — a key
 * typed straight after picking would be lost (seen in CI as "tem" for
 * "Item"; same class of bug as issue #4).
 */
export function focusEditorNow(editor: Editor): void {
  if (!editor.view.hasFocus()) editor.view.focus()
}

/** Inserts a rows × cols table with a header row at the selection. */
export function insertTable(editor: Editor, rows: number, cols: number): boolean {
  focusEditorNow(editor)
  return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
}
