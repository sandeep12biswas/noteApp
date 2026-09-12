// Right-click folder menu — DESIGN.md §2.1. "New subfolder" and "Rename"
// were both previously wired up store-side (`createFolder`/`renameFolder`)
// with no way to reach them from the UI at all: `FolderNode`'s own
// `addingChild` state had no trigger, and nothing called `renameFolder`.
// Same popover pattern as `SegmentColorMenu.tsx`/`FolderIconMenu.tsx`
// (outside-click/Escape to close, roving keyboard nav).
import { useEffect, useRef } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'

export function FolderContextMenu({
  x,
  y,
  onNewSubfolder,
  onRename,
  onClose,
}: {
  x: number
  y: number
  onNewSubfolder: () => void
  onRename: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref)

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
      aria-label="Folder actions"
      className="fixed z-50 flex flex-col rounded border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onNewSubfolder()
          onClose()
        }}
        className="rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        New subfolder
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onRename()
          onClose()
        }}
        className="rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        Rename
      </button>
    </div>
  )
}
