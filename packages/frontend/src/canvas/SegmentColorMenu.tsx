// Right-click colour picker — DESIGN.md §4.2. Every choice is a border
// colour carrying its matching 8%-opacity fill (`fillForBorder`, so there's
// only ever one choice to make, not two lists to keep in sync); a ring marks
// the segment's current colour; "None" clears both. Closes on outside
// click/Escape like any other transient popover.
//
// Same palette as the Page colour menu (layout/ColorPalette.tsx): the 9
// original colours as quick picks, a shade grid, recent colours and the
// colour wheel. The shade grid stops at the "light" row: the two palest rows
// would make a border you can't see on a white page.
import { useRef } from 'react'
import { darkestShades } from '../lib/colorShades'
import { useRecentSegmentColors } from '../lib/recentColors'
import { SEGMENT_BORDER_COLORS, fillForBorder } from '../lib/segmentColors'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { MENU_TEXT_BUTTON_CLASSNAME, POPOVER_CLASSNAME, useClampToViewport, useDismiss } from '../layout/ColorPickerMenu'
import { ColorPalette } from '../layout/ColorPalette'

const SEGMENT_SHADES = darkestShades(8)

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
  useDismiss(ref, onClose)
  useClampToViewport(ref, x, y)
  const recentColors = useRecentSegmentColors((s) => s.colors)
  const addRecentColor = useRecentSegmentColors((s) => s.add)

  const pickAndClose = (border: string) => {
    onPick(border, fillForBorder(border))
    onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Segment colour"
      className={POPOVER_CLASSNAME + ' w-64 overflow-y-auto'}
      style={{ left: x, top: y, maxHeight: 'calc(100vh - 16px)' }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ColorPalette
        label="Colour"
        presetsHeading="Quick picks"
        presets={SEGMENT_BORDER_COLORS}
        hues={SEGMENT_SHADES.hues}
        shadeNames={SEGMENT_SHADES.names}
        recent={recentColors}
        activeColor={activeColor}
        wheelInitialColor="#2563eb"
        onPick={pickAndClose}
        onWheelPick={(color) => {
          addRecentColor(color)
          pickAndClose(color)
        }}
        footer={
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
        }
      />
    </div>
  )
}
