// UI shell state — DESIGN.md §5.3 (ribbon tabs) §5.1 (layout). Kept separate
// from the future CanvasStore (DESIGN.md §7.1, segments/editorRefs/etc. —
// lands with Phase 2's CanvasRoot work) since this is chrome state, not
// document state.
import { create } from 'zustand'

export const RIBBON_TABS = ['Home', 'Insert', 'Draw', 'View'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

// DESIGN.md §5.3 View tab "Zoom in/out"; §10 "Zoom corrects AABB
// coordinates and the ink canvas" — every consumer of raw pointer deltas
// (CanvasRoot's click-to-create, SegmentHost's drag/resize, InkLayer's
// strokes) must divide by `zoom` to convert on-screen pixels back into the
// canvas's own (unscaled) coordinate space that `segment.x/y/w/h` and ink
// strokes are stored in.
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
}

// DESIGN.md §9.5 Plugin Manager UI — a dedicated "Plugins" tab in the left
// sidebar swaps the main content area (`PageList` + `EditorPane`) for the
// Plugin Manager, the same way switching ribbon tabs swaps the ribbon panel.
export type MainView = 'notebook' | 'plugins'

interface UIState {
  activeRibbonTab: RibbonTab
  setActiveRibbonTab: (tab: RibbonTab) => void
  zoom: number
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  activeView: MainView
  setActiveView: (view: MainView) => void
}

export const useUIStore = create<UIState>((set) => ({
  activeRibbonTab: 'Home',
  setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab }),
  zoom: 1,
  zoomIn: () => set((s) => ({ zoom: clampZoom(s.zoom + ZOOM_STEP) })),
  zoomOut: () => set((s) => ({ zoom: clampZoom(s.zoom - ZOOM_STEP) })),
  resetZoom: () => set({ zoom: 1 }),
  activeView: 'notebook',
  setActiveView: (view) => set({ activeView: view }),
}))
