// Exercises the decoration mechanics directly against a bare TipTap Editor
// (no React) — not through the real dictionary singleton (spellcheck.ts's
// module-level fetch would need a real network origin; see test/setup.ts's
// fetch stub for why that's fine for other tests but this file wants
// deterministic control over which words are "misspelled").
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { misspelledWordAt, Spellcheck, triggerRescan } from './spellcheckExtension'
import * as spellcheckModule from '../lib/spellcheck'

function fakeEngine(misspelled: Set<string>) {
  return {
    check: (word: string) => !misspelled.has(word.toLowerCase()),
    suggest: () => [],
    addPersonalWord: () => {},
    ignoreWord: () => {},
    hydratePersonalWords: () => {},
  } as unknown as spellcheckModule.Engine
}

let editors: Editor[] = []

function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: [StarterKit, Spellcheck], content })
  editors.push(editor)
  return editor
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Spellcheck decoration', () => {
  it('decorates a misspelled word after the debounce fires, and misspelledWordAt finds it', async () => {
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine(new Set(['wrold'])))
    const editor = makeEditor('<p>hello wrold</p>')

    await vi.advanceTimersByTimeAsync(300)

    // "hello wrold" -> "wrold" starts right after "hello " (positions are
    // 1-indexed into the doc, "hello " is 6 chars, plus the paragraph's
    // opening position 1).
    const wrongWordPos = editor.state.doc.textContent.indexOf('wrold') + 2 // +1 for doc start, +1 to land inside the word
    const hit = misspelledWordAt(editor.view, wrongWordPos)
    expect(hit?.word).toBe('wrold')

    const helloPos = editor.state.doc.textContent.indexOf('hello') + 2
    expect(misspelledWordAt(editor.view, helloPos)).toBeNull()
  })

  it('a rapid burst of transactions only triggers one rescan, not one per keystroke', async () => {
    const engine = fakeEngine(new Set(['wrold']))
    const checkSpy = vi.spyOn(engine, 'check')
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(engine)
    const editor = makeEditor('<p></p>')

    // The initial mount-time rescan already resolves once immediately;
    // let it settle, then reset the counter before the burst under test.
    await vi.advanceTimersByTimeAsync(300)
    checkSpy.mockClear()

    for (const char of 'wrold') {
      editor.chain().insertContentAt(editor.state.doc.content.size - 1, char).run()
      await vi.advanceTimersByTimeAsync(50) // well under the 300ms debounce
    }
    expect(checkSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    // One rescan of "wrold" -> exactly one check() call, not five.
    expect(checkSpy).toHaveBeenCalledTimes(1)
  })

  it('triggerRescan forces an immediate recompute, bypassing the debounce', async () => {
    const misspelled = new Set(['wrold'])
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine(misspelled))
    const editor = makeEditor('<p>wrold</p>')
    await vi.advanceTimersByTimeAsync(300)

    const pos = editor.state.doc.textContent.indexOf('wrold') + 2
    expect(misspelledWordAt(editor.view, pos)).not.toBeNull()

    // Simulate "Add to Dictionary": the word stops being misspelled, then
    // force a rescan without waiting for the debounce.
    misspelled.delete('wrold')
    triggerRescan(editor.view)
    await vi.advanceTimersByTimeAsync(0) // let the already-resolved getSpellEngine() promise's .then() flush

    expect(misspelledWordAt(editor.view, pos)).toBeNull()
  })

  it('destroying the editor clears the pending debounce timer without throwing', async () => {
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine(new Set(['wrold'])))
    const editor = makeEditor('<p></p>')
    await vi.advanceTimersByTimeAsync(300)

    editor.chain().insertContentAt(1, 'wrold').run() // schedules a debounced rescan
    editor.destroy()
    editors = editors.filter((e) => e !== editor) // already destroyed, don't double-destroy in afterEach

    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  })
})
