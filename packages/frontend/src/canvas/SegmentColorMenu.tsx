// Right-click colour picker — DESIGN.md §4.2. 9 border swatches, each
// carrying its matching 8%-opacity fill (`fillForBorder`, so there's only
// ever one choice to make, not two lists to keep in sync); a ring marks the
// segment's current colour; "None" clears both. Closes on outside
// click/Escape like any other transient popover.
import { useEffect, useRef } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { SEGMENT_BORDER_COLORS, fillForBorder } from '../lib/segmentColors'

export function SegmentColorMenu({
  x,
  y,
  activeColor,
  onPick,
  onClear,
  onClose,
}: {
  x: number
  y: number
  activeColor: string | null
  onPick: (border: string, fill: string) => void
  onClear: () => void
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
      aria-label="Segment colour"
      className="fixed z-50 flex flex-col gap-2 rounded border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Colour swatches">
        {SEGMENT_BORDER_COLORS.map((border) => {
          const active = activeColor === border
          return (
            <button
              key={border}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              aria-label={`Colour ${border}`}
              onClick={() => {
                onPick(border, fillForBorder(border))
                onClose()
              }}
              className={'h-6 w-6 rounded-full border-2 ' + (active ? 'ring-2 ring-offset-1 ring-blue-500' : '')}
              style={{ backgroundColor: border, borderColor: border }}
            />
          )
        })}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClear()
          onClose()
        }}
        className="rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        None
      </button>
    </div>
  )
}
