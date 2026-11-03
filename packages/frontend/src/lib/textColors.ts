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
