// In-app colour wheel for the Page colour menu: the wheel picks hue (angle)
// and saturation (distance from the centre), a slider picks brightness, and
// a hex box takes an exact value. Nothing applies until Apply.
//
// The wheel is pure CSS — a conic gradient of hues under a white-to-
// transparent radial gradient (that is HSV with v = 1), under a black layer
// of opacity 1 − v — so it needs no canvas and matches lib/hsv.ts exactly.
// Angles run clockwise from the top, like `conic-gradient`.
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { type Hsv, hexToHsv, hsvToHex, parseHex } from '../lib/hsv'
import { MENU_TEXT_BUTTON_CLASSNAME } from './ColorPickerMenu'

const WHEEL_SIZE = 168
const HUE_GRADIENT = 'conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'

export function ColorWheel({
  initialColor,
  onApply,
  onCancel,
}: {
  initialColor: string
  onApply: (color: string) => void
  onCancel: () => void
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initialColor))
  const [hexText, setHexText] = useState(() => parseHex(initialColor) ?? '#ffffff')
  const wheelRef = useRef<HTMLDivElement | null>(null)
  // The hex box mirrors every wheel/slider change, so a valid entry there is
  // the exact colour (no rounding through HSV for a typed value).
  const typed = parseHex(hexText)
  const color = typed ?? hsvToHex(hsv)
  const hexValid = typed !== null

  useEffect(() => wheelRef.current?.focus(), [])

  /** Wheel/slider/keyboard changes rewrite the hex box; typing in it doesn't fight back. */
  const update = (next: Hsv) => {
    setHsv(next)
    setHexText(hsvToHex(next))
  }

  const pickAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const radius = rect.width / 2
    if (radius === 0) return
    const dx = e.clientX - rect.left - radius
    const dy = e.clientY - rect.top - radius
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    update({ ...hsv, h, s: Math.min(1, Math.hypot(dx, dy) / radius) })
  }

  const onWheelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 15 : 5
    if (e.key === 'ArrowRight') update({ ...hsv, h: (hsv.h + step) % 360 })
    else if (e.key === 'ArrowLeft') update({ ...hsv, h: (hsv.h - step + 360) % 360 })
    else if (e.key === 'ArrowUp') update({ ...hsv, s: Math.min(1, hsv.s + step / 100) })
    else if (e.key === 'ArrowDown') update({ ...hsv, s: Math.max(0, hsv.s - step / 100) })
    else if (e.key === 'Enter') onApply(color)
    else return
    e.preventDefault()
  }

  const angle = (hsv.h * Math.PI) / 180
  const markerX = WHEEL_SIZE / 2 + Math.sin(angle) * hsv.s * (WHEEL_SIZE / 2)
  const markerY = WHEEL_SIZE / 2 - Math.cos(angle) * hsv.s * (WHEEL_SIZE / 2)

  return (
    <div className="flex flex-col items-center gap-2" data-testid="colour-wheel">
      <div
        ref={wheelRef}
        role="slider"
        tabIndex={0}
        data-own-arrows
        aria-label="Colour wheel"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`Hue ${Math.round(hsv.h)}°, saturation ${Math.round(hsv.s * 100)}%`}
        title="Drag to pick a colour. Arrow keys: ←/→ hue, ↑/↓ saturation"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          pickAt(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) pickAt(e)
        }}
        onKeyDown={onWheelKey}
        className="relative cursor-crosshair touch-none rounded-full border border-black/30 outline-none focus-visible:ring-2 focus-visible:ring-lavender-600 focus-visible:ring-offset-2"
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, background: `radial-gradient(circle closest-side, #fff, transparent), ${HUE_GRADIENT}` }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-full bg-black" style={{ opacity: 1 - hsv.v }} />
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: markerX, top: markerY, backgroundColor: color }}
        />
      </div>

      <label className="flex w-full flex-col gap-1 text-[11px] text-gray-600 dark:text-gray-300">
        Brightness
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv.v * 100)}
          onChange={(e) => update({ ...hsv, v: Number(e.target.value) / 100 })}
          aria-label="Brightness"
          className="h-3 w-full cursor-pointer appearance-none rounded-full border border-black/30"
          style={{ background: `linear-gradient(to right, #000, ${hsvToHex({ ...hsv, v: 1 })})` }}
        />
      </label>

      <div className="flex w-full items-center gap-2">
        <div className="flex overflow-hidden rounded-control border border-black/30" title="Current / new">
          <span data-testid="colour-wheel-current" className="h-7 w-7" style={{ backgroundColor: initialColor }} />
          <span data-testid="colour-wheel-preview" className="h-7 w-7" style={{ backgroundColor: color }} />
        </div>
        <input
          type="text"
          aria-label="Hex colour"
          aria-invalid={!hexValid}
          spellCheck={false}
          maxLength={7}
          value={hexText}
          onChange={(e) => {
            setHexText(e.target.value)
            const parsed = parseHex(e.target.value)
            if (parsed) setHsv(hexToHsv(parsed))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hexValid) onApply(color)
          }}
          className={
            'w-full min-w-0 rounded-control border px-1.5 py-1 font-mono text-xs dark:bg-gray-800 ' +
            (hexValid ? 'border-gray-300 dark:border-gray-600' : 'border-red-500')
          }
        />
      </div>

      <div className="flex w-full justify-end gap-1">
        <button type="button" role="menuitem" onClick={onCancel} className={MENU_TEXT_BUTTON_CLASSNAME}>
          Cancel
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!hexValid}
          onClick={() => onApply(color)}
          className="rounded-control bg-lavender-600 px-3 py-1 text-xs font-medium text-white hover:bg-lavender-700 disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
