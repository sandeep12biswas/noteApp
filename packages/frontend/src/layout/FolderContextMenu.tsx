// Right-click folder menu — DESIGN.md §2.1. "New subfolder" and "Rename"
// were both previously wired up store-side (`createFolder`/`renameFolder`)
// with no way to reach them from the UI at all: `FolderNode`'s own
// `addingChild` state had no trigger, and nothing called `renameFolder`.
// Same popover pattern as `SegmentColorMenu.tsx`/`FolderIconMenu.tsx`
// (outside-click/Escape to close, roving keyboard nav).
// "Delete Folder <name>" (reported bug: no way to delete a file or folder
// from the note at all) asks for confirmation in place — same inline
// Yes/No idiom `PluginManagerUI.tsx`'s uninstall button already uses —
// since deleting a folder cascades to every subfolder and file inside it.
import { useEffect, useRef, useState } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'

export function FolderContextMenu({
  x,
  y,
  folderName,
  onNewSubfolder,
  onRename,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  folderName: string
  onNewSubfolder: () => void
  onRename: () => void
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
      aria-label="Folder actions"
      className="fixed z-50 flex flex-col rounded border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {confirmingDelete ? (
        <div className="flex flex-col gap-1 px-2 py-1 text-xs text-gray-700 dark:text-gray-200">
          <p className="max-w-[180px]">Delete “{folderName}” and everything inside it?</p>
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
        <>
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
          <button
            type="button"
            role="menuitem"
            onClick={() => setConfirmingDelete(true)}
            className="rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            Delete Folder “{folderName}”
          </button>
        </>
      )}
    </div>
  )
}
