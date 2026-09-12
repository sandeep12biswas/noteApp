// Manual light/dark override control — Phase 6 "Zoom + dark mode" (see
// uiStore.test.ts's own header comment). Lives in StatusBar, not RibbonRoot:
// this is an always-visible, app-wide indicator/control like the
// canvas/linear mode toggle beside it, not per-tab ribbon chrome. No icon
// library in this project (FolderIconMenu.tsx's own precedent is plain
// emoji glyphs), so this follows suit rather than adding one.
import { useThemeStore, type ThemePreference } from '../store/themeStore'

const GLYPH: Record<ThemePreference, string> = {
  system: '🖥️',
  light: '☀️',
  dark: '🌙',
}

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const cycleTheme = useThemeStore((s) => s.cycleTheme)

  return (
    <button
      type="button"
      aria-label={`Theme: ${theme} (click to change)`}
      title={`Theme: ${theme}`}
      onClick={cycleTheme}
      className="capitalize hover:text-gray-700 dark:hover:text-gray-200"
    >
      {GLYPH[theme]} {theme}
    </button>
  )
}
