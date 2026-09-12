// Exercises setFontSize/unsetFontSize directly against a bare TipTap
// Editor (no React) — same pattern as spellcheckExtension.test.ts.
import { Editor } from '@tiptap/core'
import TextStyle from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { FontSize } from './fontSizeExtension'

let editors: Editor[] = []

function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: [StarterKit, TextStyle, FontSize], content })
  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
})

describe('setFontSize/unsetFontSize', () => {
  it('wraps the selection in a textStyle mark carrying font-size', () => {
    const editor = makeEditor('<p>hello world</p>')
    editor.commands.selectAll()
    editor.commands.setFontSize('24px')
    expect(editor.getHTML()).toContain('font-size: 24px')
  })

  it('unsetFontSize removes the style', () => {
    const editor = makeEditor('<p>hello world</p>')
    editor.commands.selectAll()
    editor.commands.setFontSize('24px')
    editor.commands.unsetFontSize()
    expect(editor.getHTML()).not.toContain('font-size')
  })
})
