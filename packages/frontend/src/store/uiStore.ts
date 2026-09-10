// UI shell state — DESIGN.md §5.3 (ribbon tabs) §5.1 (layout). Kept separate
// from the future CanvasStore (DESIGN.md §7.1, segments/editorRefs/etc. —
// lands with Phase 2's CanvasRoot work) since this is chrome state, not
// document state.
import { create } from 'zustand'

export const RIBBON_TABS = ['Home', 'Insert', 'Draw', 'View'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

interface UIState {
  activeRibbonTab: RibbonTab
  setActiveRibbonTab: (tab: RibbonTab) => void
}

export const useUIStore = create<UIState>((set) => ({
  activeRibbonTab: 'Home',
  setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab }),
}))
