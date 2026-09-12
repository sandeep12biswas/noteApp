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
