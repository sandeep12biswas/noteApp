// Folder icon picker — DESIGN.md §2.1. Two groups: the lavender icons
// (issue #40; the default is the plain lavender folder) and the original
// emoji. See lib/folderIcons.ts for how each is stored.
// "Changeable folder icons (built-in set + external import)": built-in set only for now: importing a custom
// icon would need new asset storage (there's nowhere to persist an
// uploaded image today — `Folder.icon` is a single string field, fine for
// an emoji, not for arbitrary image data) and is real follow-up work, not
// this pass's scope. Same popover pattern as `SegmentColorMenu.tsx`
// (outside-click/Escape to close, roving keyboard nav).
import { useEffect, useRef, type ReactNode } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { EMOJI_FOLDER_ICONS, LAVENDER_FOLDER_ICONS, LAVENDER_PREFIX } from '../lib/folderIcons'
import { FolderIcon } from './FolderIcon'

function IconGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="grid grid-cols-6 gap-1">{children}</div>
    </div>
  )
}

function IconChoice({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      aria-label={label}
      title={label.replace(/^Icon /, '')}
      onClick={onClick}
      className={
        'flex h-7 w-7 items-center justify-center rounded text-base hover:bg-lavender-50 dark:hover:bg-gray-800 ' +
        (active ? 'ring-2 ring-offset-1 ring-lavender-500 dark:ring-offset-gray-900' : '')
      }
    >
      {children}
    </button>
  )
}

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
  const pick = (icon: string | null) => {
    onPick(icon)
    onClose()
  }

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
      <IconGroup label="Lavender">
        {LAVENDER_FOLDER_ICONS.map(({ name, label }) => {
          const value = `${LAVENDER_PREFIX}${name}`
          return (
            <IconChoice key={value} label={`Icon ${label}`} active={activeIcon === value} onClick={() => pick(value)}>
              <FolderIcon icon={value} className="!h-5 !w-5" />
            </IconChoice>
          )
        })}
      </IconGroup>
      <IconGroup label="Emoji">
        {EMOJI_FOLDER_ICONS.map((icon) => (
          <IconChoice key={icon} label={`Icon ${icon}`} active={activeIcon === icon} onClick={() => pick(icon)}>
            {icon}
          </IconChoice>
        ))}
      </IconGroup>
      <button
        type="button"
        role="menuitem"
        onClick={() => pick(null)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <FolderIcon icon={null} /> Default
      </button>
    </div>
  )
}
