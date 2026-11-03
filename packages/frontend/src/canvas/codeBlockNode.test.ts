// Issue #10: leaving a code block (Esc, a trailing paragraph to click into).
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { exitCodeBlock } from './codeBlockNode'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import { useUIStore } from '../store/uiStore'

let editors: Editor[] = []
function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: segmentEditorExtensions, content })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const e of editors) e.destroy()
  editors = []
  useUIStore.setState({ formatPainter: { armed: false, sticky: false, format: null } })
})
const flush = () => new Promise((r) => setTimeout(r, 0))
const types = (editor: Editor) => editor.getJSON().content!.map((n) => n.type)
const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key, ...init })))

describe('leaving a code block', () => {
  it('a note that ends with a code block gets an empty paragraph after it when opened', async () => {
    const editor = makeEditor('<pre><code>x = 1</code></pre>')
    await flush()
    expect(types(editor)).toEqual(['codeBlock', 'paragraph'])
  })

  it('the trailing paragraph is added as soon as a code block ends the note, and is not an undo step', async () => {
    const editor = makeEditor('<p>Intro</p><p></p>')
    editor.chain().focus('end').toggleCodeBlock().insertContent('x').run()
    expect(types(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
    editor.commands.undo()
    expect(types(editor)[1]).not.toBe('codeBlock')
  })

  it('Esc moves the caret to the empty line below, without adding another', () => {
    const editor = makeEditor('<pre><code>x = 1</code></pre><p></p>')
    editor.commands.setTextSelection(3)
    expect(press(editor, 'Escape')).toBe(true)
    expect(editor.state.selection.$head.parent.type.name).toBe('paragraph')
    expect(types(editor)).toEqual(['codeBlock', 'paragraph'])
  })

  it('Esc inserts a line when the block is followed by text', () => {
    const editor = makeEditor('<pre><code>x = 1</code></pre><p>After</p>')
    editor.commands.setTextSelection(3)
    expect(exitCodeBlock(editor)).toBe(true)
    expect(types(editor)).toEqual(['codeBlock', 'paragraph', 'paragraph'])
    expect(editor.getJSON().content![2]!.content![0]!.text).toBe('After')
    expect(editor.state.selection.$head.parent.content.size).toBe(0)
  })

  it('Esc is left to the Format Painter while it is armed', () => {
    const editor = makeEditor('<pre><code>x = 1</code></pre><p></p>')
    editor.commands.setTextSelection(3)
    useUIStore.setState({ formatPainter: { armed: true, sticky: false, format: null } })
    expect(press(editor, 'Escape')).toBeFalsy()
    expect(editor.state.selection.$head.parent.type.name).toBe('codeBlock')
  })

  it('Esc outside a code block does nothing', () => {
    const editor = makeEditor('<p>Text</p>')
    editor.commands.setTextSelection(2)
    expect(press(editor, 'Escape')).toBeFalsy()
    expect(editor.getHTML()).toBe('<p>Text</p>')
  })

  it("TipTap's own exits still work: ArrowDown on the last line, Enter three times", () => {
    const editor = makeEditor('<pre><code>x</code></pre><p>After</p>')
    editor.commands.setTextSelection(2) // end of "x"
    press(editor, 'ArrowDown')
    expect(editor.state.selection.$head.parent.type.name).toBe('paragraph')

    const other = makeEditor('<pre><code>x</code></pre>')
    other.commands.setTextSelection(2)
    for (let i = 0; i < 3; i++) press(other, 'Enter')
    expect(other.state.selection.$head.parent.type.name).toBe('paragraph')
    expect(other.getJSON().content![0]!.content![0]!.text).toBe('x')
  })
})
