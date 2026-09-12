// Right-click file menu — DESIGN.md §2.2. Same popover pattern as
// `FolderContextMenu.tsx` (outside-click/Escape to close, roving keyboard
// nav, inline Yes/No confirmation before the destructive action).
import { useEffect, useRef, useState } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'

export function FileContextMenu({
  x,
  y,
  fileName,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  fileName: string
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
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
      aria-label="File actions"
      className="fixed z-50 flex flex-col rounded border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {confirmingDelete ? (
        <div className="flex flex-col gap-1 px-2 py-1 text-xs text-gray-700 dark:text-gray-200">
          <p className="max-w-[180px]">Delete “{fileName}”?</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmingDelete(false)} className="text-gray-500 hover:underline">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete()
                onClose()
              }}
              className="font-medium text-red-600 hover:underline"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => setConfirmingDelete(true)}
          className="rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          Delete File “{fileName}”
        </button>
      )}
    </div>
  )
}
