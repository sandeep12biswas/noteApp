// Phase 6 "Zoom + dark mode" — see uiStore.test.ts's own header comment.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from './themeStore'

const STORAGE_KEY = 'flownote:theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  useThemeStore.setState({ theme: 'system' })
})

describe('setTheme', () => {
  it('persists the choice and toggles the .dark class on <html>', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    useThemeStore.getState().setTheme('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('resolves system against prefers-color-scheme', () => {
    const matchMediaMock = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
    })
    vi.stubGlobal('matchMedia', matchMediaMock)

    useThemeStore.getState().setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    vi.unstubAllGlobals()
  })
})

describe('cycleTheme', () => {
  it('advances system -> light -> dark -> system', () => {
    expect(useThemeStore.getState().theme).toBe('system')

    useThemeStore.getState().cycleTheme()
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().cycleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')

    useThemeStore.getState().cycleTheme()
    expect(useThemeStore.getState().theme).toBe('system')
  })
})
