// Roving-focus keyboard navigation — Phase 6 "Accessibility pass"
// (DESIGN.md's own bullets: "keyboard navigation in section/page lists",
// "focus trap in menus"). Shared by `SlashMenu`/`SegmentColorMenu` (popover
// menus, `[role^="menuitem"]` items) and `PageList`/`SectionSidebar` (plain
// button lists) rather than duplicated: all four need the same thing a
// native `<select>` or a browser context menu gives for free — ArrowUp/
// ArrowDown move focus among items (wrapping at the ends), Home/End jump to
// the first/last, and (for the popover menus, not the always-visible lists)
// focus lands on the first item as soon as it opens. Selection itself stays
// plain Enter/Space/click on a focused `<button>`, which browsers already
// handle.
import { useEffect } from 'react'

export function useMenuKeyboardNav(
  containerRef: React.RefObject<HTMLElement | null>,
  options: { autoFocus?: boolean; itemSelector?: string } = {},
): void {
  const { autoFocus = true, itemSelector = '[role^="menuitem"]' } = options
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const items = () => Array.from(container.querySelectorAll<HTMLElement>(itemSelector))

    // `SlashMenu` opens *while the user is still typing* in the segment
    // editor (its own open/close condition is driven by further keystrokes
    // reaching that editor, not this menu) — stealing focus there would
    // break typing, so it opts out with `autoFocus: false` and only gets
    // arrow-key nav once/if the user tabs into the menu themselves.
    // `SegmentColorMenu` opens like a native context menu, with nothing
    // else competing for keyboard input, so it keeps the default.
    if (autoFocus) items()[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      const list = items()
      if (list.length === 0) return
      const currentIndex = list.indexOf(document.activeElement as HTMLElement)

      // ArrowRight/Left are aliases for next/previous — harmless for a
      // single-column menu (SlashMenu) and lets a grid one (the colour
      // swatches in SegmentColorMenu) navigate along its own axis too,
      // without a bespoke 2D grid nav for nine buttons.
      let nextIndex: number | null = null
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % list.length
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
        nextIndex = currentIndex < 0 ? list.length - 1 : (currentIndex - 1 + list.length) % list.length
      else if (e.key === 'Home') nextIndex = 0
      else if (e.key === 'End') nextIndex = list.length - 1

      if (nextIndex === null) return
      e.preventDefault()
      list[nextIndex]?.focus()
    }

    container.addEventListener('keydown', onKeyDown)
    return () => container.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `autoFocus` is read once at mount time by design, not tracked reactively
  }, [containerRef])
}
