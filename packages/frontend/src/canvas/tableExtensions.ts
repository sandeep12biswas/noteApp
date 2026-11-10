// Tables (issue #37): TipTap's table nodes, plus a coloured header row.
//
// Header cells (`tableHeader`, i.e. <th>) carry a `background` colour —
// null means the default, FlowNote lavender — and always render with a
// text colour picked for contrast against it (WCAG AA, 4.5:1), so a header
// stays readable whatever colour it's given, in light and dark themes.
// Body cells keep the editor's normal text colour (index.css).
//
// Part of segmentEditorExtensions, so tables load in canvas and linear
// mode alike and are saved with the segment's content like anything else.
import { type CommandProps, type Editor } from '@tiptap/core'
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
  }
}

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
  Table.configure({ resizable: true, lastColumnResizable: false, HTMLAttributes: { class: 'flownote-table' } }),
  TableRow,
  ColoredTableHeader,
  TableCell,
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
