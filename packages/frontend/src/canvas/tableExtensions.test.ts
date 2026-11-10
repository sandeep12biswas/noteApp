// Tables (issue #37) against a bare TipTap editor with the real segment extension list.
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { contrastRatio } from '../lib/textColors'
import { HEADER_COLORS } from '../layout/TableRibbonGroup'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import { DEFAULT_HEADER_BACKGROUND, headerTextOn, insertTable } from './tableExtensions'

let editors: Editor[] = []
function makeEditor(content: string | object = '<p></p>'): Editor {
  const editor = new Editor({ extensions: segmentEditorExtensions, content })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const e of editors) e.destroy()
  editors = []
})

/** jsdom reports inline colours as rgb(); compare in that form. */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
const bgOf = (th: HTMLElement) => th.style.backgroundColor
const headers = (editor: Editor) => [...editor.view.dom.querySelectorAll('th')] as HTMLElement[]

describe('tables', () => {
  it('inserts a rows × columns table whose first row is the header', () => {
    const editor = makeEditor()
    insertTable(editor, 3, 4)
    const table = editor.getJSON().content!.find((n) => n.type === 'table')!
    expect(table.content).toHaveLength(3)
    expect(table.content![0]!.content!.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader', 'tableHeader'])
    expect(table.content![1]!.content!.every((c) => c.type === 'tableCell')).toBe(true)
  })

  it('draws the header in lavender with contrasting text by default', () => {
    const editor = makeEditor()
    insertTable(editor, 2, 2)
    const th = headers(editor)[0]!
    expect(bgOf(th)).toBe(rgb(DEFAULT_HEADER_BACKGROUND))
    expect(th.style.color).toBe(rgb(headerTextOn(DEFAULT_HEADER_BACKGROUND)))
    expect(contrastRatio(DEFAULT_HEADER_BACKGROUND, headerTextOn(DEFAULT_HEADER_BACKGROUND))).toBeGreaterThanOrEqual(4.5)
  })

  it('picks header text with at least 4.5:1 contrast for every offered colour, and for awkward mid-tones', () => {
    for (const bg of [...HEADER_COLORS, '#777777', '#808080', '#ff0000', '#00aaff', '#ffff00', '#000000', '#ffffff']) {
      expect(contrastRatio(bg, headerTextOn(bg)), bg).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a light header gets dark text and a dark header gets light text', () => {
    expect(contrastRatio(headerTextOn('#e5e7eb'), '#000000')).toBeLessThan(2) // dark ink
    expect(contrastRatio(headerTextOn('#362463'), '#ffffff')).toBeLessThan(2) // light ink
  })

  it('recolours every header cell of the table the cursor is in, and back to default', () => {
    const editor = makeEditor()
    insertTable(editor, 2, 3)
    editor.commands.setTableHeaderColor('#e5e7eb')
    expect(headers(editor).map(bgOf)).toEqual([rgb('#e5e7eb'), rgb('#e5e7eb'), rgb('#e5e7eb')])
    expect(headers(editor)[0]!.style.color).toBe(rgb(headerTextOn('#e5e7eb')))
    editor.commands.setTableHeaderColor(null)
    expect(headers(editor).map(bgOf)).toEqual([rgb(DEFAULT_HEADER_BACKGROUND), rgb(DEFAULT_HEADER_BACKGROUND), rgb(DEFAULT_HEADER_BACKGROUND)])
  })

  it('the header colour survives a save/load round trip (segment JSON)', () => {
    const editor = makeEditor()
    insertTable(editor, 2, 2)
    editor.commands.setTableHeaderColor('#0f766e')
    const reloaded = makeEditor(editor.getJSON())
    expect(bgOf(headers(reloaded)[0]!)).toBe(rgb('#0f766e'))
  })

  it('keeps the structure of a table pasted from another app', () => {
    const editor = makeEditor('<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apples</td><td>3</td></tr></table>')
    expect(headers(editor).map((th) => th.textContent)).toEqual(['Name', 'Qty'])
    expect([...editor.view.dom.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Apples', '3'])
  })

  it('Tab moves to the next cell and adds/deletes rows and columns', () => {
    const editor = makeEditor()
    insertTable(editor, 2, 2)
    const cellText = () => editor.state.selection.$from.parent.textContent
    editor.commands.insertContent('A')
    editor.commands.goToNextCell()
    editor.commands.insertContent('B')
    expect(cellText()).toBe('B')
    editor.commands.addRowAfter()
    editor.commands.addColumnAfter()
    const table = () => editor.getJSON().content!.find((n) => n.type === 'table')!
    expect(table().content).toHaveLength(3)
    expect(table().content![0]!.content).toHaveLength(3)
    editor.commands.deleteColumn()
    expect(table().content![0]!.content).toHaveLength(2)
  })
})
