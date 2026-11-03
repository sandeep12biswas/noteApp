import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { getAiDraft } from './aiDraftExtension'
import { segmentEditorExtensions } from './segmentEditorExtensions'

let editors: Editor[] = []
function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: segmentEditorExtensions, content })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const e of editors) e.destroy()
  editors = []
})

/** Start of the (empty) last paragraph's content. */
const endOfDoc = (editor: Editor) => editor.state.doc.content.size - 1

function start(editor: Editor, prompt: string, pos = endOfDoc(editor), marks = editor.state.doc.resolve(pos).marks()) {
  editor.commands.startAiDraft({ pos, prompt, marks })
}

describe('AI draft', () => {
  it('writes the prompt as one line and streams the answer below it', () => {
    const editor = makeEditor('<p>Intro</p><p></p>')
    start(editor, 'Write a haiku')
    editor.commands.appendAiDraft('Leaves ')
    editor.commands.appendAiDraft('fall')

    expect(editor.getHTML()).toBe('<p>Intro</p><p>Write a haiku</p><p>Leaves fall</p>')
    const draft = getAiDraft(editor.state)!
    expect(editor.state.doc.textBetween(draft.from, draft.promptTo)).toBe('Write a haiku')
    expect(editor.state.doc.textBetween(draft.from, draft.to, '\n')).toBe('Write a haiku\nLeaves fall')
  })

  it('turns newlines into new paragraphs, never empty ones — even when split across chunks', () => {
    const editor = makeEditor('<p></p>')
    start(editor, 'List')
    for (const chunk of ['\nOne\n', '\nTwo', '\n\n', 'Three\n']) editor.commands.appendAiDraft(chunk)

    expect(editor.getHTML()).toBe('<p>List</p><p>One</p><p>Two</p><p>Three</p>')
  })

  it('gives the text the destination formatting: marks and block type', () => {
    const editor = makeEditor('<h2></h2>')
    const bold = editor.schema.marks.bold!.create()
    const style = editor.schema.marks.textStyle!.create({ color: '#ff0000', fontSize: '24px' })
    start(editor, 'Ask', 1, [bold, style])
    editor.commands.appendAiDraft('First\nSecond')

    const blocks = editor.getJSON().content!
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'heading'])
    for (const block of blocks) {
      const marks = block.content![0]!.marks!
      expect(marks.map((m) => m.type).sort()).toEqual(['bold', 'textStyle'])
      expect(marks.find((m) => m.type === 'textStyle')!.attrs).toMatchObject({ color: '#ff0000', fontSize: '24px' })
    }
  })

  it('splits list items, not just the paragraph inside them', () => {
    const editor = makeEditor('<ul><li><p></p></li></ul>')
    start(editor, 'Ideas', 3)
    editor.commands.appendAiDraft('A\nB')
    expect(editor.getHTML()).toBe('<ul><li><p>Ideas</p></li><li><p>A</p></li><li><p>B</p></li></ul>')
  })

  it('Discard leaves the document exactly as it was', () => {
    const editor = makeEditor('<p>Intro</p><p></p>')
    const before = editor.getJSON()
    start(editor, 'Prompt')
    editor.commands.appendAiDraft('Answer\nMore')
    editor.commands.discardAiDraft()

    expect(editor.getJSON()).toEqual(before)
    expect(getAiDraft(editor.state)).toBeNull()
  })

  it('Keep leaves the text as ordinary content, and one undo removes all of it', () => {
    const editor = makeEditor('<p>Intro</p><p></p>')
    const before = editor.getJSON()
    start(editor, 'Prompt')
    editor.commands.appendAiDraft('Answer\nMore')
    editor.commands.keepAiDraft()

    expect(editor.getHTML()).toBe('<p>Intro</p><p>Prompt</p><p>Answer</p><p>More</p>')
    expect(getAiDraft(editor.state)).toBeNull()
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })

  it('Discard after Keep does nothing — there is no draft left', () => {
    const editor = makeEditor('<p></p>')
    start(editor, 'P')
    editor.commands.keepAiDraft()
    expect(editor.commands.discardAiDraft()).toBe(false)
    expect(editor.getText()).toBe('P')
  })

  it('follows edits made elsewhere while the draft is open', () => {
    const editor = makeEditor('<p>Intro</p><p></p>')
    start(editor, 'Prompt')
    editor.commands.appendAiDraft('Ans')
    editor.commands.insertContentAt(1, 'Big ') // typed before the draft
    editor.commands.appendAiDraft('wer')

    expect(editor.getHTML()).toBe('<p>Big Intro</p><p>Prompt</p><p>Answer</p>')
    const draft = getAiDraft(editor.state)!
    expect(editor.state.doc.textBetween(draft.from, draft.to, '\n')).toBe('Prompt\nAnswer')
  })

  it('tints the draft and marks the prompt line', () => {
    const editor = makeEditor('<p></p>')
    start(editor, 'Prompt')
    editor.commands.appendAiDraft('Answer')
    const html = editor.view.dom.innerHTML
    expect(html).toContain('ai-draft-prompt')
    expect(html).toContain('class="ai-draft"')
    editor.commands.keepAiDraft()
    expect(editor.view.dom.innerHTML).not.toContain('ai-draft')
  })
})
