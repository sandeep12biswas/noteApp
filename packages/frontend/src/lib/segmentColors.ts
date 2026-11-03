// Segment colour palette — DESIGN.md §4.2 "9 border colours, 9 matching
// 8%-opacity fills". A single swatch picks both: the fill is *derived* from
// the border (not a second independent choice) so DESIGN.md's "matching"
// stays true by construction rather than by two lists staying in sync.
export const SEGMENT_BORDER_COLORS = [
  '#dc2626', // red
  '#ea580c', // orange
  '#d97706', // amber
  '#65a30d', // lime
  '#16a34a', // green
  '#0d9488', // teal
  '#2563eb', // blue
  '#7c3aed', // violet
  '#db2777', // pink
] as const

export type SegmentBorderColor = (typeof SEGMENT_BORDER_COLORS)[number]

/** Converts a `#rrggbb` border colour into its matching 8%-opacity fill, as `rgba(...)`. */
export function fillForBorder(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.08)`
}
