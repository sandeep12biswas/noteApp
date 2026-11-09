// The palette shared by the Page colour and Segment colour menus: quick-pick
// presets, a darkest-to-lightest shade grid per hue, recently used wheel
// colours, and "More colours…", which swaps the palette for the in-app
// colour wheel. The host menu supplies the popover, any header (Page
// colour's "Apply to" switch) and the footer actions (Use default / None).
import { type ReactNode, useRef, useState } from 'react'
import type { HueShades } from '../lib/colorShades'
import { MENU_TEXT_BUTTON_CLASSNAME, SwatchGrid } from './ColorPickerMenu'
import { ColorWheel } from './ColorWheel'
import { ShadeGrid } from './ShadeGrid'

const SECTION_HEADING = 'px-0.5 text-[10px] font-medium text-gray-500 uppercase dark:text-gray-400'

export function ColorPalette({
  label,
  presetsHeading,
  presets,
  hues,
  shadeNames,
  recent,
  activeColor,
  wheelInitialColor,
  onPick,
  onWheelPick,
  footer,
}: {
  /** Prefix of every swatch's accessible name, e.g. "This page" → "This page Sepia". */
  label: string
  presetsHeading: string
  presets: readonly (string | { name: string; color: string })[]
  hues: readonly HueShades[]
  shadeNames: readonly string[]
  recent: readonly string[]
  activeColor: string | null
  /** Colour the wheel starts from when nothing is active. */
  wheelInitialColor: string
  /** A swatch was picked. */
  onPick: (color: string) => void
  /** The wheel's Apply: the host also remembers the colour as recent. */
  onWheelPick: (color: string) => void
  /** Actions under the palette (hidden while the wheel is open). */
  footer?: ReactNode
}) {
  const [wheelOpen, setWheelOpen] = useState(false)
  const moreColoursRef = useRef<HTMLButtonElement | null>(null)

  if (wheelOpen) {
    return (
      <ColorWheel
        initialColor={activeColor ?? wheelInitialColor}
        onApply={onWheelPick}
        onCancel={() => {
          setWheelOpen(false)
          requestAnimationFrame(() => moreColoursRef.current?.focus())
        }}
      />
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className={SECTION_HEADING}>{presetsHeading}</span>
        <SwatchGrid label={label} groupLabel={`${label} ${presetsHeading.toLowerCase()}`} colors={presets} activeColor={activeColor} onPick={onPick} />
      </div>
      <div className="flex flex-col gap-1">
        <span className={SECTION_HEADING}>Shades</span>
        <ShadeGrid label={label} hues={hues} shadeNames={shadeNames} activeColor={activeColor} onPick={onPick} />
      </div>
      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={SECTION_HEADING}>Recent</span>
          <SwatchGrid label={`${label} recent`} groupLabel={`${label} recent colours`} colors={recent} activeColor={activeColor} onPick={onPick} />
        </div>
      )}
      <div className="flex flex-col">
        <button
          ref={moreColoursRef}
          type="button"
          role="menuitem"
          onClick={() => setWheelOpen(true)}
          className={MENU_TEXT_BUTTON_CLASSNAME + ' flex items-center gap-1.5'}
        >
          <span
            aria-hidden
            className="h-4 w-4 rounded-full border border-black/30"
            style={{ background: 'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
          />
          More colours…
        </button>
        {footer}
      </div>
    </>
  )
}
