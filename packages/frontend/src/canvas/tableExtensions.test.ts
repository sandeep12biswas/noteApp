// Tables (issue #37) against a bare TipTap editor with the real segment extension list.
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { contrastRatio } from '../lib/textColors'
import { HEADER_COLORS } from '../layout/TableRibbonGroup'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import { DEFAULT_HEADER_BACKGROUND, headerTextOn, insertTable, NO_ROW_SHADING } from './tableExtensions'

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

  describe('row shading', () => {
    const rows = (editor: Editor) => [...editor.view.dom.querySelectorAll('tr')] as HTMLElement[]
    /** Each row as the CSS sees it: header, band 1/2 with its colour, own colour, or plain. */
    const shading = (editor: Editor) =>
      rows(editor).map((tr) => {
        if (tr.querySelector('th')) return 'header'
        if (tr.dataset.band) return `band${tr.dataset.band} ${tr.style.getPropertyValue('--band')}`
        if (tr.hasAttribute('data-row-color')) return `own ${tr.style.getPropertyValue('--row-bg')}`
        return 'plain'
      })
    /** Puts the cursor in body row `index` (0 = the header row), first cell. */
    const cursorInRow = (editor: Editor, index: number) => {
      const cell = rows(editor)[index]!.querySelector('td, th')!
      editor.commands.setTextSelection(editor.view.posAtDOM(cell, 0) + 1)
    }

    it('bands the body rows in the header colour: lightest under the header, then one shade darker, alternating', () => {
      const editor = makeEditor()
      insertTable(editor, 5, 2)
      const c = DEFAULT_HEADER_BACKGROUND
      expect(shading(editor)).toEqual(['header', `band1 ${c}`, `band2 ${c}`, `band1 ${c}`, `band2 ${c}`])
    })

    it('follows a header colour change, and keeps alternating when rows are added', () => {
      const editor = makeEditor()
      insertTable(editor, 3, 2)
      editor.commands.setTableHeaderColor('#0f766e')
      editor.commands.addRowAfter()
      expect(shading(editor)).toEqual(['header', 'band1 #0f766e', 'band2 #0f766e', 'band1 #0f766e'])
    })

    it('starts the bands at the first row when the header row is turned off', () => {
      const editor = makeEditor()
      insertTable(editor, 3, 2)
      editor.commands.toggleHeaderRow()
      expect(shading(editor).map((s) => s.split(' ')[0])).toEqual(['band1', 'band2', 'band1'])
    })

    it('can band in another colour than the header, go back to the header, or turn the shading off', () => {
      const editor = makeEditor()
      insertTable(editor, 3, 2)
      editor.commands.setTableRowShading('#b45309')
      expect(shading(editor)).toEqual(['header', 'band1 #b45309', 'band2 #b45309'])
      editor.commands.setTableRowShading(NO_ROW_SHADING)
      expect(shading(editor)).toEqual(['header', 'plain', 'plain'])
      editor.commands.setTableRowShading(null)
      expect(shading(editor)).toEqual(['header', `band1 ${DEFAULT_HEADER_BACKGROUND}`, `band2 ${DEFAULT_HEADER_BACKGROUND}`])
    })

    it('gives one row its own colour, with readable text, over the bands; and back', () => {
      const editor = makeEditor()
      insertTable(editor, 4, 2)
      cursorInRow(editor, 2)
      editor.commands.setTableRowColor('#1e3a8a')
      const c = DEFAULT_HEADER_BACKGROUND
      expect(shading(editor)).toEqual(['header', `band1 ${c}`, 'own #1e3a8a', `band1 ${c}`])
      expect(contrastRatio('#1e3a8a', rows(editor)[2]!.style.getPropertyValue('--row-fg').trim())).toBeGreaterThanOrEqual(4.5)
      cursorInRow(editor, 2)
      editor.commands.setTableRowColor(null)
      expect(shading(editor)).toEqual(['header', `band1 ${c}`, `band2 ${c}`, `band1 ${c}`])
    })

    it('row colours and the banding setting survive a save/load round trip', () => {
      const editor = makeEditor()
      insertTable(editor, 3, 2)
      editor.commands.setTableRowShading('#15803d')
      cursorInRow(editor, 1)
      editor.commands.setTableRowColor('#fde68a')
      const reloaded = makeEditor(editor.getJSON())
      expect(shading(reloaded)).toEqual(['header', 'own #fde68a', 'band2 #15803d'])
    })
  })
})
