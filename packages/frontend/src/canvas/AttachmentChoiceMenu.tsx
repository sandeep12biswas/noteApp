// "Attach as file" / "Embed in note" popover — shown after pasting a
// non-screenshot file (lib/attachmentPaste.ts), so the user picks which
// `attachmentBlock` mode to insert. Same popover shell every other menu in
// this codebase already uses (`FolderContextMenu.tsx`/`SegmentColorMenu.tsx`):
// outside-click/Escape to close, `useMenuKeyboardNav` for roving focus,
// `fixed z-50 ... role="menu"`.
//
// `autoFocus: false` — same reasoning `SlashMenu.tsx` documents for the
// same opt-out: this menu opens while the segment's document is *still
// empty* (the attachment node isn't inserted until the user picks a mode
// here), so the default auto-focus-first-item behavior would blur the
// still-empty editor and trip `deleteIfEmptyAndUncolored`'s auto-delete-on-
// blur before the user ever gets to choose — found live via `run-electron`:
// the segment (and the menu with it) vanished the instant the chooser
// opened.
import { useEffect, useRef } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'

export function AttachmentChoiceMenu({
  x,
  y,
  fileName,
  onChoose,
  onClose,
}: {
  x: number
  y: number
  fileName: string
  onChoose: (mode: 'file' | 'embed') => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref, { autoFocus: false })

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

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Attach file"
      className="fixed z-50 flex flex-col gap-1 rounded border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="max-w-[220px] truncate px-1 pb-1 text-xs text-gray-500 dark:text-gray-400">“{fileName}”</p>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onChoose('file')
          onClose()
        }}
        className="rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        Attach as file
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onChoose('embed')
          onClose()
        }}
        className="rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        Embed in note
      </button>
    </div>
  )
}
