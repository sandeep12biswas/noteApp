// Table templates (issue #38): turning a table into a template and back.
// A template is the TipTap `table` node itself — rows, column widths
// (`colwidth`), header text and colours (`background`), spans — so
// inserting one is just inserting a deep copy: editing the copy can never
// change the template, and changing the template later can't reach tables
// already in notes.
import type { Editor, JSONContent } from '@tiptap/core'

/** The table around the selection, as JSON, or null when the cursor isn't in one. */
export function tableAtSelection(editor: Editor): JSONContent | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return node.toJSON() as JSONContent
  }
  return null
}

const EMPTY_CELL_CONTENT: JSONContent[] = [{ type: 'paragraph' }]

/**
 * The template version of a table: a deep copy, with the body cells emptied
 * unless `includeContents`. Header cells always keep their text (the column
 * names) and every cell keeps its attributes (widths, colours, spans).
 */
export function toTemplateTable(table: JSONContent, includeContents: boolean): JSONContent {
  const copy = structuredClone(table)
  if (!includeContents) {
    for (const row of copy.content ?? []) {
      for (const cell of row.content ?? []) {
        if (cell.type === 'tableCell') cell.content = structuredClone(EMPTY_CELL_CONTENT)
      }
    }
  }
  return copy
}

/** Inserts an independent copy of a template's table at the selection. */
export function insertTemplateTable(editor: Editor, table: Record<string, unknown>): boolean {
  return editor.chain().focus().insertContent(structuredClone(table) as JSONContent).run()
}

/** Templates whose name contains `query` (ignoring case), names starting with it first. */
export function filterTemplates<T extends { name: string }>(templates: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...templates]
  const hits = templates.filter((t) => t.name.toLowerCase().includes(q))
  return [...hits.filter((t) => t.name.toLowerCase().startsWith(q)), ...hits.filter((t) => !t.name.toLowerCase().startsWith(q))]
}

/** Rows × columns of a template's table, for previews and labels. */
export function templateSize(table: Record<string, unknown>): { rows: number; cols: number } {
  const rows = (table as JSONContent).content ?? []
  const cols = Math.max(0, ...rows.map((r) => (r.content ?? []).reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0)))
  return { rows: rows.length, cols }
}

/** The header row's text, e.g. for a preview: ["Item", "Qty"]. */
export function templateHeaders(table: Record<string, unknown>): string[] {
  const first = (table as JSONContent).content?.[0]
  if (!first?.content?.every((c) => c.type === 'tableHeader')) return []
  const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
  return first.content.map(text)
}
