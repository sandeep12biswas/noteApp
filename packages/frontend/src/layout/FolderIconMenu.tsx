// Folder icon picker — DESIGN.md §2.1 "changeable folder icons (built-in
// set + external import)". Built-in set only for now: importing a custom
// icon would need new asset storage (there's nowhere to persist an
// uploaded image today — `Folder.icon` is a single string field, fine for
// an emoji, not for arbitrary image data) and is real follow-up work, not
// this pass's scope. Same popover pattern as `SegmentColorMenu.tsx`
// (outside-click/Escape to close, roving keyboard nav).
import { useEffect, useRef } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { DEFAULT_FOLDER_ICON, FOLDER_ICONS } from '../lib/folderIcons'

export function FolderIconMenu({
  x,
  y,
  activeIcon,
  onPick,
  onClose,
}: {
  x: number
  y: number
  activeIcon: string | null
  onPick: (icon: string | null) => void
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
      aria-label="Folder icon"
      className="fixed z-50 flex flex-col gap-2 rounded border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Icons">
        {FOLDER_ICONS.map((icon) => {
          const active = activeIcon === icon
          return (
            <button
              key={icon}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              aria-label={`Icon ${icon}`}
              onClick={() => {
                onPick(icon)
                onClose()
              }}
              className={
                'flex h-7 w-7 items-center justify-center rounded text-base hover:bg-gray-100 dark:hover:bg-gray-800 ' +
                (active ? 'ring-2 ring-offset-1 ring-blue-500' : '')
              }
            >
              {icon}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPick(null)
          onClose()
        }}
        className="rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Default ({DEFAULT_FOLDER_ICON})
      </button>
    </div>
  )
}
