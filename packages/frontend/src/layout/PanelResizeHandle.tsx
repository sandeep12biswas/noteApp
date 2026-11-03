// The draggable edge on the right side of a side panel (DESIGN.md §2: the
// vertical panels are mouse-drag resizable). Widths live in uiStore and are
// clamped there (lib/panelWidths.ts): each panel stays within its min/max
// and the editor always keeps its minimum width.
//
//   - drag with the mouse (pointer capture, like a segment's resize handle);
//   - double-click to reset to the default width;
//   - keyboard: it's a focusable `separator` — Left/Right arrows move it
//     10px (50px with Shift), Home/End jump to the min/max width.
//
// The width is saved when a drag (or key press) ends, not on every move.
import type { KeyboardEvent, PointerEvent } from 'react'
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, type ResizablePanel } from '../lib/panelWidths'
import { useUIStore } from '../store/uiStore'

const KEY_STEP = 10
const KEY_STEP_LARGE = 50

export function PanelResizeHandle({ panel, label }: { panel: ResizablePanel; label: string }) {
  const width = useUIStore((s) => s.panelWidths[panel])
  const setPanelWidth = useUIStore((s) => s.setPanelWidth)
  const persistPanelWidths = useUIStore((s) => s.persistPanelWidths)
  const resetPanelWidth = useUIStore((s) => s.resetPanelWidth)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    const startX = e.clientX
    const startWidth = useUIStore.getState().panelWidths[panel]
    // Keep the resize cursor and stop text selection everywhere while dragging.
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: globalThis.PointerEvent) => setPanelWidth(panel, startWidth + (ev.clientX - startX))
    const onUp = () => {
      handle.releasePointerCapture?.(e.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = ''
      persistPanelWidths()
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = width - step
    else if (e.key === 'ArrowRight') next = width + step
    else if (e.key === 'Home') next = MIN_PANEL_WIDTH
    else if (e.key === 'End') next = MAX_PANEL_WIDTH
    if (next === null) return
    e.preventDefault()
    setPanelWidth(panel, next)
    persistPanelWidths()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={MAX_PANEL_WIDTH}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      data-testid={`resize-${panel}`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => resetPanelWidth(panel)}
      onKeyDown={onKeyDown}
      // A 4px hit area centred on the panel's border; the 2px negative
      // margins cancel its width exactly, so the layout (and the editor's
      // minimum-width maths in lib/panelWidths.ts) is unaffected.
      // Highlighted on hover/focus.
      className="relative z-10 -mx-[2px] w-[4px] shrink-0 cursor-col-resize outline-none hover:bg-blue-400/60 focus-visible:bg-blue-500"
    />
  )
}
