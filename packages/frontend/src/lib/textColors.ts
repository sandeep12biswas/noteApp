// Ribbon text-formatting colour palettes — DESIGN.md §5.3 "Highlight ·
// Text colour". Previously each button only cycled through a fixed
// 5-colour list with no way to reach anything else; these are the expanded
// preset sets the new dropdown picker (RibbonRoot.tsx's ColorDropdownButton)
// offers, alongside a native `<input type="color">` for any arbitrary
// colour (the OS/browser's own picker — effectively the "colour wheel" a
// custom-built one would otherwise have to reinvent).
export const HIGHLIGHT_COLORS = [
  '#fef08a', // yellow
  '#bbf7d0', // green
  '#bfdbfe', // blue
  '#fecaca', // red
  '#e9d5ff', // purple
  '#fed7aa', // orange
  '#fbcfe8', // pink
  '#a5f3fc', // cyan
  '#e5e7eb', // gray
] as const

export const TEXT_COLORS = [
  '#111827', // near-black (default text)
  '#dc2626', // red
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0d9488', // teal
  '#6b7280', // gray
] as const

const DARK_TEXT = '#111827'
const LIGHT_TEXT = '#f9fafb'

/** sRGB channels (0–255) of a `#rgb`, `#rrggbb` or `rgb()/rgba()` colour; null for anything else. */
function parseColor(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(c)
  if (m) return [...m[1]!].map((h) => parseInt(h + h, 16)) as [number, number, number]
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c)
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as [number, number, number]
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio of two colours this module can parse. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(parseColor(a)!), luminance(parseColor(b)!)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The text colour to show on a highlight (issue #6): near-black on light
 * highlights, near-white on dark ones — whichever contrasts more — so
 * highlighted text reads the same in both themes and on custom colours.
 * Null when the colour can't be parsed (the text then keeps its own colour).
 */
export function readableTextOn(background: string): string | null {
  if (!parseColor(background)) return null
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT
}

// ---------------------------------------------------------------------------
// Text that follows the editor background (issue #12). The page background
// itself (issue #11) lives in store/editorBackgroundStore.ts.

/** WCAG AA contrast for ordinary text. */
export const CONTRAST_TEXT = 4.5
/** WCAG AA contrast for large text and UI parts such as borders; below it a colour is "low contrast". */
export const CONTRAST_LOW = 3

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

/** `a` mixed with `b`: `t` = 0 is all `a`, 1 is all `b`. */
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as [number, number, number]
}

/** The least `ink` mixed into `background` (as `#rrggbb`) that still reaches `min` contrast on it. */
function mutedInk(ink: string, background: string, min: number): string {
  const [i, bg] = [parseColor(ink)!, parseColor(background)!]
  for (let t = 0.3; t < 1; t += 0.02) {
    const c = toHex(mix(bg, i, t))
    if (contrastRatio(c, background) >= min) return c
  }
  return ink
}

export interface EditorInk {
  /** Ordinary text: near-black or near-white, whichever reads better. */
  text: string
  /** Secondary text (timestamp, placeholders, quotes): ≥ 4.5:1. */
  muted: string
  /** Borders and handles: ≥ 3:1. */
  border: string
  /** A barely-there tint for backgrounds such as inline code. */
  faint: string
}

/** The editor pane's text colours for `background` (any colour this module can parse). */
export function editorInk(background: string): EditorInk {
  let text = readableTextOn(background) ?? DARK_TEXT
  // Mid-tones (#777 and the like) reach only ~4.3:1 with either soft ink:
  // fall back to pure black or white, whichever reads better.
  if (contrastRatio(text, background) < CONTRAST_TEXT) {
    text = contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? '#000000' : '#ffffff'
  }
  return {
    text,
    muted: mutedInk(text, background, CONTRAST_TEXT),
    border: mutedInk(text, background, CONTRAST_LOW),
    faint: toHex(mix(parseColor(background)!, parseColor(text)!, 0.1)),
  }
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

/**
 * The nearest shade of `color` that reaches `min` contrast on `background`:
 * same hue and saturation, lightness moved away from the background (darker
 * on a light background, lighter on a dark one). `color` itself when it
 * already reads well; the editor's ordinary text colour when no shade does.
 */
export function adjustForContrast(color: string, background: string, min = CONTRAST_TEXT): string {
  const rgb = parseColor(color)
  if (!rgb || !parseColor(background)) return color
  if (contrastRatio(color, background) >= min) return color
  const [h, s, l] = rgbToHsl(rgb)
  const darken = readableTextOn(background) === DARK_TEXT
  for (let step = 1; step <= 100; step++) {
    const next = darken ? l - step / 100 : l + step / 100
    if (next < 0 || next > 1) break
    const candidate = toHex(hslToRgb([h, s, next]))
    if (contrastRatio(candidate, background) >= min) return candidate
  }
  return editorInk(background).text
}

/** Up to `n` palette hues (`TEXT_COLORS`, minus the default near-black) adjusted to read well on `background`. */
export function suggestTextColors(background: string, n = 4): string[] {
  const out: string[] = []
  for (const color of TEXT_COLORS.slice(1)) {
    const adjusted = adjustForContrast(color, background)
    if (!out.includes(adjusted)) out.push(adjusted)
    if (out.length === n) break
  }
  return out
}

/** Whether `color` reads poorly (below 3:1) on `background`. False when either can't be parsed. */
export function isLowContrast(color: string, background: string): boolean {
  if (!parseColor(color) || !parseColor(background)) return false
  return contrastRatio(color, background) < CONTRAST_LOW
}

/** Whether this module can parse `color`. */
export function isParsableColor(color: string): boolean {
  return parseColor(color) !== null
}
