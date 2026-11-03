// Right-click menu for a panel's *empty space* — "New folder" in the folder
// panel, "New page" in the page panel. Right-clicking an existing row keeps
// that row's own menu (FolderContextMenu / FileContextMenu); this one only
// covers the space around them. Same popover pattern as those menus
// (outside-click/Escape to close, roving keyboard nav).
import { useEffect, useRef } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'

export interface PanelMenuItem {
  label: string
  onSelect: () => void
}

export function PanelContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number
  y: number
  /** Accessible name of the menu, e.g. "Folder panel actions". */
  label: string
  items: PanelMenuItem[]
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
      aria-label={label}
      className="fixed z-50 flex flex-col rounded border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className="rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
