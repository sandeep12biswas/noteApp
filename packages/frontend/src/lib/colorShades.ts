// The shade grid shared by the Page colour and Segment colour menus: one
// column per hue, each running from darkest to lightest (Tailwind's 900 … 50
// steps).

/** Names of the shade rows, darkest first. */
export const SHADE_NAMES = ['darkest', 'darker', 'dark', 'deep', 'strong', 'medium', 'soft', 'light', 'lighter', 'lightest'] as const

export interface HueShades {
  name: string
  /** One colour per `SHADE_NAMES` row, darkest first. */
  shades: readonly string[]
}

export const COLOR_SHADES: readonly HueShades[] = [
  { name: 'Red', shades: ['#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444', '#f87171', '#fca5a5', '#fecaca', '#fee2e2', '#fef2f2'] },
  { name: 'Orange', shades: ['#7c2d12', '#9a3412', '#c2410c', '#ea580c', '#f97316', '#fb923c', '#fdba74', '#fed7aa', '#ffedd5', '#fff7ed'] },
  { name: 'Amber', shades: ['#78350f', '#92400e', '#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7', '#fffbeb'] },
  { name: 'Green', shades: ['#14532d', '#166534', '#15803d', '#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7', '#f0fdf4'] },
  { name: 'Teal', shades: ['#134e4a', '#115e59', '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#ccfbf1', '#f0fdfa'] },
  { name: 'Blue', shades: ['#1e3a8a', '#1e40af', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff'] },
  { name: 'Indigo', shades: ['#312e81', '#3730a3', '#4338ca', '#4f46e5', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff', '#eef2ff'] },
  { name: 'Purple', shades: ['#581c87', '#6b21a8', '#7e22ce', '#9333ea', '#a855f7', '#c084fc', '#d8b4fe', '#e9d5ff', '#f3e8ff', '#faf5ff'] },
  { name: 'Pink', shades: ['#831843', '#9d174d', '#be185d', '#db2777', '#ec4899', '#f472b6', '#f9a8d4', '#fbcfe8', '#fce7f3', '#fdf2f8'] },
  { name: 'Grey', shades: ['#111827', '#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb', '#f3f4f6', '#f9fafb'] },
]

/** The first `rows` shades of every hue (darkest first), e.g. to drop the palest rows. */
export function darkestShades(rows: number): { hues: readonly HueShades[]; names: readonly string[] } {
  return {
    hues: COLOR_SHADES.map((hue) => ({ name: hue.name, shades: hue.shades.slice(0, rows) })),
    names: SHADE_NAMES.slice(0, rows),
  }
}
