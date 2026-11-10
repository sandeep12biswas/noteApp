// The Page colour menu's shade grid: one column per hue, each running from
// darkest (top) to lightest (bottom). Arrow keys move in two dimensions
// inside the grid (`data-own-arrows` keeps the menu's linear nav out); past
// the top or bottom row they leave the grid for the menu item before/after.
import type { KeyboardEvent } from 'react'
import { SWATCH_ACTIVE, SWATCH_EDGE } from './ColorPickerMenu'

export function ShadeGrid({
  label,
  hues,
  shadeNames,
  activeColor,
  onPick,
}: {
  /** Each swatch is labelled "<label> <hue> <shade name>". */
  label: string
  hues: readonly { name: string; shades: readonly string[] }[]
  /** One name per row, darkest first. */
  shadeNames: readonly string[]
  activeColor: string | null
  onPick: (color: string) => void
}) {
  const columns = hues.length

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grid = e.currentTarget
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    const index = cells.indexOf(e.target as HTMLElement)
    if (index < 0) return
    const row = Math.floor(index / columns)
    const col = index % columns
    const rows = Math.ceil(cells.length / columns)

    let next: number | 'before' | 'after' | null = null
    if (e.key === 'ArrowRight') next = col < columns - 1 ? index + 1 : row * columns
    else if (e.key === 'ArrowLeft') next = col > 0 ? index - 1 : row * columns + columns - 1
    else if (e.key === 'ArrowDown') next = row < rows - 1 ? index + columns : 'after'
    else if (e.key === 'ArrowUp') next = row > 0 ? index - columns : 'before'
    else if (e.key === 'Home') next = row * columns
    else if (e.key === 'End') next = row * columns + columns - 1
    if (next === null) return
    e.preventDefault()

    if (typeof next === 'number') {
      cells[next]?.focus()
      return
    }
    // Leave the grid for the neighbouring menu item, wrapping like the menu does.
    const menuItems = Array.from(grid.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const first = menuItems.indexOf(cells[0]!)
    const last = menuItems.indexOf(cells[cells.length - 1]!)
    const target = next === 'before' ? menuItems[first - 1] ?? menuItems[menuItems.length - 1] : menuItems[last + 1] ?? menuItems[0]
    target?.focus()
  }

  return (
    <div
      role="group"
      aria-label={`${label} shades`}
      data-own-arrows
      onKeyDown={onKeyDown}
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {/* Row by row, so DOM order (Tab, the menu's Home/End) matches what is seen. */}
      {shadeNames.flatMap((shadeName, row) =>
        hues.map((hue) => {
          const color = hue.shades[row]!
          const active = activeColor === color
          return (
            <button
              key={`${hue.name}-${row}`}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              aria-label={`${label} ${hue.name} ${shadeName}`}
              title={`${hue.name}, ${shadeName} (${color})`}
              onClick={() => onPick(color)}
              className={
                SWATCH_EDGE +
                ' aspect-square w-full rounded-[3px] transition-transform hover:z-10 hover:scale-125 focus-visible:z-10 focus-visible:scale-125 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lavender-600' +
                (active ? ' z-10 ' + SWATCH_ACTIVE : '')
              }
              style={{ backgroundColor: color }}
            />
          )
        }),
      )}
    </div>
  )
}
