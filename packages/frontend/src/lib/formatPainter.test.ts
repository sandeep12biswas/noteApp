// Exercises captureFormat/applyFormat directly against a bare TipTap Editor
// built from the same extension list segments actually use (no React) —
// same pattern as canvas/fontSizeExtension.test.ts.
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { segmentEditorExtensions } from '../canvas/segmentEditorExtensions'
import { applyFormat, captureFormat } from './formatPainter'

let editors: Editor[] = []
function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: segmentEditorExtensions, content })
  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
})

describe('captureFormat', () => {
  it('captures bold, colour, highlight and font family from the selection', () => {
    const editor = makeEditor('<p>Hello world</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 }) // "Hello"
    editor.commands.setBold()
    editor.commands.setColor('#ff0000')
    editor.commands.setHighlight({ color: '#ffff00' })
    editor.commands.setFontFamily('Georgia')

    const format = captureFormat(editor)
    expect(format.bold).toBe(true)
    expect(format.italic).toBe(false)
    expect(format.color).toBe('#ff0000')
    expect(format.highlightColor).toBe('#ffff00')
    expect(format.fontFamily).toBe('Georgia')
  })

  it('captures the current block\'s text alignment', () => {
    const editor = makeEditor('<p>Hello world</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setTextAlign('center')

    expect(captureFormat(editor).textAlign).toBe('center')
  })

  it('reports unset marks as false/null', () => {
    const editor = makeEditor('<p>Hello world</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 })

    const format = captureFormat(editor)
    expect(format.bold).toBe(false)
    expect(format.color).toBeNull()
    expect(format.highlightColor).toBeNull()
    expect(format.fontFamily).toBeNull()
  })
})

describe('applyFormat', () => {
  it('paints the captured formatting onto a different selection', () => {
    const editor = makeEditor('<p>Hello world</p><p>Second line</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 }) // "Hello"
    editor.commands.setBold()
    editor.commands.setColor('#ff0000')
    const format = captureFormat(editor)

    editor.commands.setTextSelection({ from: 14, to: 20 }) // "Second"
    applyFormat(editor, format)

    editor.commands.setTextSelection({ from: 14, to: 20 })
    expect(editor.isActive('bold')).toBe(true)
    expect(editor.getAttributes('textStyle').color).toBe('#ff0000')
  })

  it('clears formatting the target had that the captured format lacks', () => {
    const editor = makeEditor('<p>Hello world</p><p>Second line</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 }) // "Hello" — plain
    const format = captureFormat(editor)

    editor.commands.setTextSelection({ from: 14, to: 20 }) // "Second" — italic
    editor.commands.setItalic()
    applyFormat(editor, format)

    editor.commands.setTextSelection({ from: 14, to: 20 })
    expect(editor.isActive('italic')).toBe(false)
  })
})
