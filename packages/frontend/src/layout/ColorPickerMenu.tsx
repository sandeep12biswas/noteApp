// Dropdown colour picker for the ribbon's Highlight/Text colour buttons —
// DESIGN.md §5.3. Replaces the previous "click cycles through 5 fixed
// colours" behaviour with a real picker: a wider preset grid plus a native
// `<input type="color">` for any arbitrary colour (the OS/browser's own
// picker, which on every major platform is a full spectrum/wheel — reusing
// it is simpler and more capable than building a custom one). Same popover
// pattern as SegmentColorMenu.tsx/FolderIconMenu.tsx (outside-click/Escape
// to close, roving keyboard nav).
//
// The Text colour menu also gets `suggested` colours and a `lowContrast`
// check when the page has a background colour (issue #12).
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'

export const LOW_CONTRAST_TITLE = 'Hard to read on this background'

/** Closes a popover on an outside pointer-down or Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
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
  }, [ref, onClose])
}

export const POPOVER_CLASSNAME =
  'fixed z-50 flex flex-col gap-2 rounded border border-gray-200 bg-white p-2 text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'

export const MENU_TEXT_BUTTON_CLASSNAME =
  'rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'

/** A grid of round colour swatches (`menuitemradio`s), shared by the ribbon colour menus and the Page colour menu. */
export function SwatchGrid({
  label,
  groupLabel = label,
  colors,
  activeColor,
  onPick,
  isLowContrast,
}: {
  /** Each swatch is labelled "<label> <colour name or value>". */
  label: string
  /** The group's own label (defaults to `label`). */
  groupLabel?: string
  colors: readonly (string | { name: string; color: string })[]
  activeColor: string | null
  onPick: (color: string) => void
  isLowContrast?: (color: string) => boolean
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={groupLabel}>
      {colors.map((entry) => {
        const { name, color } = typeof entry === 'string' ? { name: entry, color: entry } : entry
        const active = activeColor === color
        const low = isLowContrast?.(color) ?? false
        return (
          <button
            key={color}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            aria-label={`${label} ${name}`}
            title={low ? `${name}: ${LOW_CONTRAST_TITLE}` : name}
            data-low-contrast={low || undefined}
            onClick={() => onPick(color)}
            className={
              'h-6 w-6 rounded-full border-2' +
              (active ? ' ring-2 ring-offset-1 ring-blue-500' : '') +
              (low ? ' opacity-40' : '')
            }
            // A light swatch (White) would vanish against the menu without a visible edge.
            style={{ backgroundColor: color, borderColor: color === '#ffffff' ? '#d1d5db' : color }}
          />
        )
      })}
    </div>
  )
}

/** "Custom…" — the OS colour picker. */
export function CustomColorInput({
  label,
  value,
  onPick,
  note,
}: {
  label: string
  value: string
  onPick: (color: string) => void
  note?: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <label className="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onPick(e.target.value)}
          className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        Custom…
      </label>
      {note}
    </div>
  )
}

export function ColorPickerMenu({
  x,
  y,
  label,
  colors,
  activeColor,
  onPick,
  onClear,
  onClose,
  suggested,
  lowContrast,
}: {
  x: number
  y: number
  label: string
  colors: readonly string[]
  activeColor: string
  onPick: (color: string) => void
  onClear?: () => void
  onClose: () => void
  /** Colours that read well on the page's background, shown first as "Suggested" (issue #12). */
  suggested?: readonly string[]
  /** Marks colours that are hard to read on the page's background: dimmed, still selectable. */
  lowContrast?: (color: string) => boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref)
  useDismiss(ref, onClose)
  const [custom, setCustom] = useState<string | null>(null)

  const pickAndClose = (color: string) => {
    onPick(color)
    onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={POPOVER_CLASSNAME}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {suggested && suggested.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="px-0.5 text-[10px] font-medium text-gray-500 uppercase dark:text-gray-400">Suggested</span>
          <SwatchGrid label={`${label} suggested`} colors={suggested} activeColor={activeColor} onPick={pickAndClose} />
        </div>
      )}
      <SwatchGrid
        label={label}
        groupLabel={`${label} swatches`}
        colors={colors}
        activeColor={activeColor}
        onPick={pickAndClose}
        isLowContrast={lowContrast}
      />
      <CustomColorInput
        label={`Custom ${label.toLowerCase()}`}
        value={activeColor}
        onPick={(color) => {
          setCustom(color)
          onPick(color)
        }}
        note={
          custom && lowContrast?.(custom) ? (
            <p role="status" className="px-1 text-[11px] text-amber-700 dark:text-amber-400">
              {LOW_CONTRAST_TITLE}
            </p>
          ) : null
        }
      />
      {onClear && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClear()
            onClose()
          }}
          className={MENU_TEXT_BUTTON_CLASSNAME}
        >
          None
        </button>
      )}
    </div>
  )
}
