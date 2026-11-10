import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { segmentEditorExtensions } from '../canvas/segmentEditorExtensions'
import { insertTable } from '../canvas/tableExtensions'
import { filterTemplates, insertTemplateTable, tableAtSelection, templateHeaders, templateSize, toTemplateTable } from './tableTemplates'

let editors: Editor[] = []
const make = (content: string | object = '<p></p>') => {
  const e = new Editor({ extensions: segmentEditorExtensions, content })
  editors.push(e)
  return e
}
afterEach(() => {
  for (const e of editors) e.destroy()
  editors = []
})

/** A 2-column table: header Item/Qty, one body row Apples/3, header coloured teal, first column 120px wide. */
function sampleTable(): Editor {
  const editor = make()
  insertTable(editor, 2, 2)
  for (const t of ['Item', 'Qty', 'Apples', '3']) {
    editor.commands.insertContent(t)
    editor.commands.goToNextCell()
  }
  editor.commands.setTableHeaderColor('#0f766e')
  editor.commands.setCellAttribute('colwidth', [120])
  return editor
}

const cellTexts = (table: Record<string, unknown>) =>
  ((table as { content: { content: { content?: { content?: { text?: string }[] }[] }[] }[] }).content).map((r) =>
    r.content.map((c) => (c.content ?? []).flatMap((p) => p.content ?? []).map((t) => t.text).join('')),
  )

describe('table templates', () => {
  it('finds the table around the cursor, and nothing outside one', () => {
    const editor = sampleTable()
    expect(tableAtSelection(editor)?.type).toBe('table')
    expect(tableAtSelection(make('<p>text</p>'))).toBeNull()
  })

  it('without contents: keeps the header text, colours and widths, empties the body', () => {
    const table = toTemplateTable(tableAtSelection(sampleTable())!, false) as Record<string, unknown>
    expect(cellTexts(table)).toEqual([['Item', 'Qty'], ['', '']])
    expect(JSON.stringify(table)).toContain('"background":"#0f766e"')
    expect(JSON.stringify(table)).toContain('"colwidth":[120]')
    expect(templateSize(table)).toEqual({ rows: 2, cols: 2 })
    expect(templateHeaders(table)).toEqual(['Item', 'Qty'])
  })

  it('with contents: keeps the body text too', () => {
    const table = toTemplateTable(tableAtSelection(sampleTable())!, true) as Record<string, unknown>
    expect(cellTexts(table)).toEqual([['Item', 'Qty'], ['Apples', '3']])
  })

  it('inserting gives an independent copy: editing it never changes the template', () => {
    const template = toTemplateTable(tableAtSelection(sampleTable())!, true) as Record<string, unknown>
    const before = JSON.stringify(template)
    const target = make()
    insertTemplateTable(target, template)
    target.commands.insertContent(' changed') // the cursor ends up in the copy's last cell
    expect(cellTexts(tableAtSelection(target) as Record<string, unknown>)[1]).toEqual(['Apples', '3 changed'])
    expect(JSON.stringify(template)).toBe(before)
  })

  it('filters by name ignoring case, prefix matches first', () => {
    const t = [{ name: 'Weekly budget' }, { name: 'Budget' }, { name: 'Tasks' }]
    expect(filterTemplates(t, 'bud').map((x) => x.name)).toEqual(['Budget', 'Weekly budget'])
    expect(filterTemplates(t, '  ').map((x) => x.name)).toEqual(['Weekly budget', 'Budget', 'Tasks'])
    expect(filterTemplates(t, 'zzz')).toEqual([])
  })
})
