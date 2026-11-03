// Persisted "default font" preference — applied only to brand-new, still-
// empty note segments (canvas/applyDefaultFontIfNew.ts), never retroactively
// to already-typed ones. Same localStorage-backed shape as themeStore.ts,
// minus that store's module-load DOM side effect: a default font has
// nothing to apply until a segment is actually created, so there's no
// "flash of wrong state" to guard against at startup.
import { create } from 'zustand'
import { FONT_FAMILIES } from '../lib/fontFamilies'

const STORAGE_KEY = 'flownote:defaultFont'
const VALID_VALUES = new Set(FONT_FAMILIES.map((f) => f.value))

export function readStoredFont(): string {
  if (typeof localStorage === 'undefined') return ''
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored !== null && VALID_VALUES.has(stored) ? stored : ''
}

interface FontState {
  /** A `lib/fontFamilies.ts` FontFamilyOption's `value`; `''` means "Default" (no override). */
  defaultFont: string
  setDefaultFont: (font: string) => void
}

export const useFontStore = create<FontState>((set) => ({
  defaultFont: readStoredFont(),
  setDefaultFont: (font) => {
    localStorage.setItem(STORAGE_KEY, font)
    set({ defaultFont: font })
  },
}))
