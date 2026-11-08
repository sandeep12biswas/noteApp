import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import { adjustClashesInEditor, findClashes } from './textColorClashes'
import { contrastRatio } from '../lib/textColors'

const NAVY = '#1e3a8a'

function text(t: string, marks: { type: string; attrs?: Record<string, unknown> }[] = []) {
  return { type: 'text', text: t, marks }
}
const color = (c: string) => ({ type: 'textStyle', attrs: { color: c } })
const doc = (...paragraphs: JSONContent[][]): JSONContent & Record<string, unknown> => ({
  type: 'doc',
  content: paragraphs.map((content) => ({ type: 'paragraph', content })),
})

/** The text colours in the editor's document, in order. */
function colorsIn(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    const c = node.marks.find((m) => m.type.name === 'textStyle')?.attrs.color
    if (typeof c === 'string') out.push(c)
  })
  return out
}

let editors: Editor[] = []
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})

describe('findClashes (issue #12)', () => {
  it('finds coloured runs below 4.5:1, across nested marks, one per passage', () => {
    const content = doc(
      [text('dark ', [color('#1d4ed8')]), text('bold dark', [color('#1d4ed8'), { type: 'bold' }]), text(' plain')],
      [text('fine', [color('#fde68a')]), text('also dark', [{ type: 'italic' }, color('rgb(30, 64, 175)')])],
    )
    const clashes = findClashes([{ id: 's1', content }], NAVY)
    expect(clashes).toEqual([
      { segmentId: 's1', color: '#1d4ed8', text: 'dark bold dark' },
      { segmentId: 's1', color: 'rgb(30, 64, 175)', text: 'also dark' },
    ])
  })

  it('ignores highlighted text (it has its own background) and uncoloured text', () => {
    const content = doc([text('hi', [color('#1d4ed8'), { type: 'highlight', attrs: { color: '#fef08a' } }]), text('plain')])
    expect(findClashes([{ id: 's1', content }], NAVY)).toEqual([])
  })

  it('finds nothing when every colour reads well', () => {
    const content = doc([text('ok', [color('#111827')])])
    expect(findClashes([{ id: 's1', content }], '#f8f1e3')).toEqual([])
  })
})

describe('adjustClashesInEditor (issue #12)', () => {
  it('re-colours clashing runs readably as one undo step, leaving others alone', () => {
    const editor = new Editor({
      extensions: segmentEditorExtensions,
      content: doc([text('blue', [color('#1d4ed8')]), text(' yellow', [color('#fde68a')])]),
    })
    editors.push(editor)

    expect(adjustClashesInEditor(editor, NAVY)).toBe(true)
    const after = findClashes([{ id: 's1', content: editor.getJSON() as Record<string, unknown> }], NAVY)
    expect(after).toEqual([])
    expect(colorsIn(editor)).toHaveLength(2)
    expect(colorsIn(editor)[1]).toBe('#fde68a')
    expect(contrastRatio(colorsIn(editor)[0]!, NAVY)).toBeGreaterThanOrEqual(4.5)

    // Nothing left to adjust.
    expect(adjustClashesInEditor(editor, NAVY)).toBe(false)

    // One undo step restores the original colour.
    editor.commands.undo()
    expect(colorsIn(editor)).toEqual(['#1d4ed8', '#fde68a'])
  })
})
