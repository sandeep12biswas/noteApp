// "Recent" colours for the colour menus: the last few colours picked on the
// colour wheel, newest first, kept per device in localStorage (like the
// theme and default page colour). One store per menu, by storage key.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { parseHex } from './hsv'

export const MAX_RECENT_COLORS = 8

export interface RecentColorsState {
  colors: string[]
  add: (color: string) => void
}

function read(storageKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((c) => (typeof c === 'string' ? parseHex(c) : null))
      .filter((c): c is string => c !== null)
      .slice(0, MAX_RECENT_COLORS)
  } catch {
    return []
  }
}

export function createRecentColorsStore(storageKey: string): UseBoundStore<StoreApi<RecentColorsState>> {
  return create<RecentColorsState>((set, get) => ({
    colors: read(storageKey),
    add: (color) => {
      const value = parseHex(color)
      if (!value) return
      const colors = [value, ...get().colors.filter((c) => c !== value)].slice(0, MAX_RECENT_COLORS)
      try {
        localStorage.setItem(storageKey, JSON.stringify(colors))
      } catch {
        // Storage blocked: remembered for this session only.
      }
      set({ colors })
    },
  }))
}

export const useRecentPageColors = createRecentColorsStore('flownote:recent-page-colours')
export const useRecentSegmentColors = createRecentColorsStore('flownote:recent-segment-colours')
export const useRecentRowColors = createRecentColorsStore('flownote:recent-row-colours')
