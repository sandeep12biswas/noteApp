// HSV ⇄ hex for the Page colour wheel (layout/ColorWheel.tsx). The wheel's
// angle is the hue and its radius the saturation; a separate slider sets the
// value (brightness). HSV rather than HSL because a CSS conic + radial
// gradient under a black overlay of opacity 1 − v draws exactly this model.

export interface Hsv {
  /** Hue, 0–360 (0 = red). */
  h: number
  /** Saturation, 0–1. */
  s: number
  /** Value (brightness), 0–1. */
  v: number
}

/** `#rgb`, `rgb`, `#rrggbb` or `rrggbb` as lower-case `#rrggbb`; null for anything else. */
export function parseHex(input: string): string | null {
  const c = input.trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(c)) return '#' + [...c].map((d) => d + d).join('')
  if (/^[0-9a-f]{6}$/.test(c)) return '#' + c
  return null
}

export function hexToHsv(hex: string): Hsv {
  const value = parseHex(hex) ?? '#ffffff'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  let h = 0
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = (((h % 360) + 360) % 360) / 60
  const c = v * s
  const x = c * (1 - Math.abs((hue % 2) - 1))
  const [r, g, b] =
    hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  const m = v - c
  return '#' + [r, g, b].map((ch) => Math.round((ch + m) * 255).toString(16).padStart(2, '0')).join('')
}
