// Right-click spelling-suggestions menu — opened by SegmentHost.tsx's/
// LinearSegmentHost.tsx's onContextMenu handler when the click lands on a
// spellcheckExtension.ts decoration. Same popover pattern as
// SegmentColorMenu.tsx (outside-click/Escape to close, roving keyboard
// nav), with one new wrinkle: suggestions load asynchronously (the
// dictionary engine is a lazy singleton), so this is the first popover in
// this codebase that isn't purely synchronous.
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { addToPersonalDictionary, getSpellEngine } from '../lib/spellcheck'
import { triggerRescan } from './spellcheckExtension'

export function SpellingSuggestionMenu({
  x,
  y,
  word,
  from,
  to,
  editor,
  onClose,
}: {
  x: number
  y: number
  word: string
  from: number
  to: number
  editor: Editor
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  useMenuKeyboardNav(ref)

  useEffect(() => {
    let cancelled = false
    getSpellEngine()
      .then((engine) => {
        if (!cancelled) setSuggestions(engine.suggest(word))
      })
      .catch(() => {
        if (!cancelled) setSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [word])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const applySuggestion = (suggestion: string) => {
    editor.chain().focus().insertContentAt({ from, to }, suggestion).run()
    onClose()
  }

  const addToDictionary = async () => {
    await addToPersonalDictionary(word)
    triggerRescan(editor.view)
    onClose()
  }

  const ignore = async () => {
    const engine = await getSpellEngine()
    engine.ignoreWord(word)
    triggerRescan(editor.view)
    onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Spelling suggestions"
      className="fixed z-50 flex min-w-[10rem] flex-col rounded border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {suggestions === null ? (
        <span className="px-2 py-1 text-xs text-gray-400">…</span>
      ) : suggestions.length === 0 ? (
        <span className="px-2 py-1 text-xs text-gray-400">No suggestions</span>
      ) : (
        suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            role="menuitem"
            onClick={() => applySuggestion(suggestion)}
            className="rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {suggestion}
          </button>
        ))
      )}
      <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
      <button
        type="button"
        role="menuitem"
        onClick={() => void addToDictionary()}
        className="rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Add to Dictionary
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void ignore()}
        className="rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Ignore
      </button>
    </div>
  )
}
