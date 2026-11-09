// Editor background colour, light mode only (issue #11). The app-wide
// default is a per-device preference kept here in localStorage, like the
// theme (themeStore.ts) and default font (fontStore.ts); a page's own colour
// is saved with the page (notebookStore's `FileEntry.background`) and syncs.
// Effective colour = page colour ?? default ?? none (the pane stays white).
//
// Any colour is allowed: the editor's text follows the background (issue
// #12, `editorInk` in lib/textColors.ts), so dark colours stay readable.
import { create } from 'zustand'
import { useNotebookStore } from './notebookStore'

const STORAGE_KEY = 'flownote:editor-background'
const HEX = /^#[0-9a-f]{6}$/i

/** Light paper tones, the Page colour menu's quick picks. */
export const PAGE_BACKGROUND_PRESETS = [
  { name: 'White', color: '#ffffff' },
  { name: 'Ivory', color: '#fffdf5' },
  { name: 'Sepia', color: '#f8f1e3' },
  { name: 'Cream', color: '#fefce8' },
  { name: 'Mint', color: '#ecfdf5' },
  { name: 'Sky', color: '#eff6ff' },
  { name: 'Lavender', color: '#f5f3ff' },
  { name: 'Rose', color: '#fff1f2' },
  { name: 'Grey', color: '#f3f4f6' },
] as const

/** Names of the shade rows, darkest first (Tailwind's 900 … 50 steps). */
export const PAGE_SHADE_NAMES = ['darkest', 'darker', 'dark', 'deep', 'strong', 'medium', 'soft', 'light', 'lighter', 'lightest'] as const

/**
 * The Page colour menu's shade grid: one column per hue, each running from
 * darkest to lightest. Dark shades are fine as page colours — the editor's
 * text follows the background (issue #12).
 */
export const PAGE_BACKGROUND_SHADES: readonly { name: string; shades: readonly string[] }[] = [
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

const RECENT_STORAGE_KEY = 'flownote:recent-page-colours'
/** How many colours from the colour wheel the menu remembers. */
export const MAX_RECENT_BACKGROUNDS = 8

/** `color` as lower-case `#rrggbb`, or null when it isn't one. */
export function normalizeBackground(color: string | null | undefined): string | null {
  return color && HEX.test(color) ? color.toLowerCase() : null
}

function readStoredBackground(): string | null {
  try {
    return normalizeBackground(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function readRecentBackgrounds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((c) => normalizeBackground(typeof c === 'string' ? c : null))
      .filter((c): c is string => c !== null)
      .slice(0, MAX_RECENT_BACKGROUNDS)
  } catch {
    return []
  }
}

interface EditorBackgroundState {
  /** The app-wide default (`#rrggbb`), or null for none (white). */
  defaultBackground: string | null
  setDefaultBackground: (color: string | null) => void
  /** Colours recently chosen on the colour wheel, newest first (per device). */
  recentBackgrounds: string[]
  addRecentBackground: (color: string) => void
}

export const useEditorBackgroundStore = create<EditorBackgroundState>((set, get) => ({
  defaultBackground: readStoredBackground(),
  recentBackgrounds: readRecentBackgrounds(),
  addRecentBackground: (color) => {
    const value = normalizeBackground(color)
    if (!value) return
    const recent = [value, ...get().recentBackgrounds.filter((c) => c !== value)].slice(0, MAX_RECENT_BACKGROUNDS)
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent))
    } catch {
      // Storage blocked: remembered for this session only.
    }
    set({ recentBackgrounds: recent })
  },
  setDefaultBackground: (color) => {
    const value = normalizeBackground(color)
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
    set({ defaultBackground: value })
  },
}))

/** Page colour ?? default ?? null. */
export function effectiveBackground(pageBackground: string | null | undefined, defaultBackground: string | null): string | null {
  return normalizeBackground(pageBackground) ?? defaultBackground
}

/** The selected page's effective background (light mode only — callers check the theme). */
export function useEffectiveBackground(): string | null {
  const pageBackground = useNotebookStore((s) => (s.selectedFileId ? s.files[s.selectedFileId]?.background : null))
  const defaultBackground = useEditorBackgroundStore((s) => s.defaultBackground)
  return effectiveBackground(pageBackground, defaultBackground)
}
