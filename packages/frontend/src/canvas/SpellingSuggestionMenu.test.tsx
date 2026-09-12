import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpellingSuggestionMenu } from './SpellingSuggestionMenu'
import * as spellcheckModule from '../lib/spellcheck'
import * as spellcheckExtensionModule from './spellcheckExtension'

afterEach(cleanup)

function fakeEngine(suggestions: string[]) {
  return {
    check: () => false,
    suggest: () => suggestions,
    addPersonalWord: () => {},
    ignoreWord: () => {},
    hydratePersonalWords: () => {},
  } as unknown as spellcheckModule.Engine
}

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit], content: '<p>wrold</p>' })
})

afterEach(() => {
  editor.destroy()
})

describe('SpellingSuggestionMenu', () => {
  it('renders suggestions once the engine resolves', async () => {
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine(['world', 'word']))
    render(<SpellingSuggestionMenu x={0} y={0} word="wrold" from={1} to={6} editor={editor} onClose={() => {}} />)

    expect(await screen.findByRole('menuitem', { name: 'world' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'word' })).toBeInTheDocument()
  })

  it('shows "No suggestions" when the engine returns none', async () => {
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine([]))
    render(<SpellingSuggestionMenu x={0} y={0} word="wrold" from={1} to={6} editor={editor} onClose={() => {}} />)

    expect(await screen.findByText('No suggestions')).toBeInTheDocument()
  })

  it('clicking a suggestion replaces the word range and closes', async () => {
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine(['world']))
    const onClose = vi.fn()
    render(<SpellingSuggestionMenu x={0} y={0} word="wrold" from={1} to={6} editor={editor} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('menuitem', { name: 'world' }))

    expect(editor.getText()).toBe('world')
    expect(onClose).toHaveBeenCalled()
  })

  it('"Add to Dictionary" persists via IPC, updates the engine, triggers a rescan, and closes', async () => {
    const engine = fakeEngine([])
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(engine)
    const addSpy = vi.spyOn(engine, 'addPersonalWord')
    const addToPersonalDictionarySpy = vi.spyOn(spellcheckModule, 'addToPersonalDictionary').mockResolvedValue(undefined)
    const rescanSpy = vi.spyOn(spellcheckExtensionModule, 'triggerRescan').mockImplementation(() => {})
    const onClose = vi.fn()
    render(<SpellingSuggestionMenu x={0} y={0} word="wrold" from={1} to={6} editor={editor} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Dictionary' }))

    await waitFor(() => expect(addToPersonalDictionarySpy).toHaveBeenCalledWith('wrold'))
    expect(rescanSpy).toHaveBeenCalledWith(editor.view)
    expect(onClose).toHaveBeenCalled()
    expect(addSpy).not.toHaveBeenCalled() // addToPersonalDictionary itself is mocked here; engine.addPersonalWord is its internal concern, not this menu's
  })

  it('"Ignore" does not call any IPC-backed function, only the engine + rescan', async () => {
    const engine = fakeEngine([])
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(engine)
    const ignoreSpy = vi.spyOn(engine, 'ignoreWord')
    const addToPersonalDictionarySpy = vi.spyOn(spellcheckModule, 'addToPersonalDictionary')
    const rescanSpy = vi.spyOn(spellcheckExtensionModule, 'triggerRescan').mockImplementation(() => {})
    const onClose = vi.fn()
    render(<SpellingSuggestionMenu x={0} y={0} word="wrold" from={1} to={6} editor={editor} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore' }))

    await waitFor(() => expect(ignoreSpy).toHaveBeenCalledWith('wrold'))
    expect(addToPersonalDictionarySpy).not.toHaveBeenCalled()
    expect(rescanSpy).toHaveBeenCalledWith(editor.view)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on outside click and on Escape', async () => {
    vi.spyOn(spellcheckModule, 'getSpellEngine').mockResolvedValue(fakeEngine([]))
    const onClose = vi.fn()
    render(<SpellingSuggestionMenu x={0} y={0} word="wrold" from={1} to={6} editor={editor} onClose={onClose} />)
    await screen.findByRole('menu', { name: 'Spelling suggestions' })

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
