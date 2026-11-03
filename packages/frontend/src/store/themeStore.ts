// Manual light/dark override — Phase 6 "Zoom + dark mode" (see
// uiStore.test.ts's own header comment). Every layout/canvas component
// already ships matching `dark:` Tailwind classes that used to follow only
// `prefers-color-scheme` (a bare media query, since Tailwind v4 has no
// config file here); index.css's `@custom-variant dark
// (&:where(.dark, .dark *));` switches that to a `.dark` class on <html>,
// and this store owns adding/removing that class plus persisting the
// choice. Kept as its own store rather than folded into uiStore (chrome
// state, plain `set()` slices) because this one has real side effects —
// localStorage I/O and mutating the DOM outside React's tree.
import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'flownote:theme'
const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark']

function readStoredTheme(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

// 'system' means "no forced class" in spirit, but since the CSS variant
// above is purely class-driven (no automatic media-query fallback once a
// custom variant is defined), 'system' is resolved here in JS by checking
// matchMedia directly and applying/removing `.dark` accordingly.
function applyThemeClass(pref: ThemePreference) {
  if (typeof document === 'undefined') return
  const isDark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

interface ThemeState {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  cycleTheme: () => void
}

const initialTheme = readStoredTheme()
// Applied at module load, before React mounts, to avoid a flash of the
// wrong theme on startup.
applyThemeClass(initialTheme)

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme)
    applyThemeClass(theme)
    set({ theme })
  },
  cycleTheme: () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(get().theme) + 1) % THEME_ORDER.length]!
    get().setTheme(next)
  },
}))

// Keep 'system' live if the OS preference changes while the window is
// open (e.g. an OS-level light/dark schedule flipping mid-session).
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().theme === 'system') applyThemeClass('system')
  })
}
