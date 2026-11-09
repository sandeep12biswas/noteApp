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

interface EditorBackgroundState {
  /** The app-wide default (`#rrggbb`), or null for none (white). */
  defaultBackground: string | null
  setDefaultBackground: (color: string | null) => void
}

export const useEditorBackgroundStore = create<EditorBackgroundState>((set) => ({
  defaultBackground: readStoredBackground(),
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
