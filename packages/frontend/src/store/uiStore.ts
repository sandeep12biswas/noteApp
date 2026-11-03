// UI shell state — DESIGN.md §5.3 (ribbon tabs) §5.1 (layout). Kept separate
// from the future CanvasStore (DESIGN.md §7.1, segments/editorRefs/etc. —
// lands with Phase 2's CanvasRoot work) since this is chrome state, not
// document state.
import { create } from 'zustand'
import type { CapturedFormat } from '../lib/formatPainter'
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTHS,
  loadPanelWidths,
  type PanelWidths,
  type ResizablePanel,
  savePanelWidths,
} from '../lib/panelWidths'

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
  // Format Painter (RibbonRoot.tsx's toggle button, CanvasRoot.tsx's
  // pointerup applier, lib/formatPainter.ts's capture/apply) — chrome
  // state, not document state, same as everything else in this store:
  // "armed" means a format has been captured and is waiting to be painted
  // onto the next selection; "sticky" (double-click to arm) keeps it armed
  // across multiple applications instead of auto-disarming after one.
  formatPainter: { armed: boolean; sticky: boolean; format: CapturedFormat | null }
  armFormatPainter: (format: CapturedFormat, sticky: boolean) => void
  disarmFormatPainter: () => void
  // Side-panel widths (lib/panelWidths.ts; PanelResizeHandle.tsx drags them).
  panelWidths: PanelWidths
  /** Sets a panel's width, clamped so the editor keeps its minimum. Doesn't save — call `persistPanelWidths()` when a drag ends. */
  setPanelWidth: (panel: ResizablePanel, width: number) => void
  persistPanelWidths: () => void
  /** Back to the default width (clamped), and saved. */
  resetPanelWidth: (panel: ResizablePanel) => void
  /** Re-clamps both widths, e.g. after the window got narrower. */
  reclampPanelWidths: () => void
}

/** The other side panel's on-screen width — the pages panel isn't shown while the Plugin Manager is open. */
function otherPanelWidth(s: Pick<UIState, 'panelWidths' | 'activeView'>, panel: ResizablePanel): number {
  if (panel === 'pages') return s.panelWidths.folders
  return s.activeView === 'notebook' ? s.panelWidths.pages : 0
}

function windowWidth(): number {
  return typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
}

export const useUIStore = create<UIState>((set, get) => ({
  activeRibbonTab: 'Home',
  setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab }),
  zoom: 1,
  zoomIn: () => set((s) => ({ zoom: clampZoom(s.zoom + ZOOM_STEP) })),
  zoomOut: () => set((s) => ({ zoom: clampZoom(s.zoom - ZOOM_STEP) })),
  resetZoom: () => set({ zoom: 1 }),
  activeView: 'notebook',
  setActiveView: (view) => set({ activeView: view }),
  formatPainter: { armed: false, sticky: false, format: null },
  armFormatPainter: (format, sticky) => set({ formatPainter: { armed: true, sticky, format } }),
  disarmFormatPainter: () => set({ formatPainter: { armed: false, sticky: false, format: null } }),
  panelWidths: loadPanelWidths(),
  setPanelWidth: (panel, width) =>
    set((s) => ({
      panelWidths: { ...s.panelWidths, [panel]: clampPanelWidth(width, otherPanelWidth(s, panel), windowWidth()) },
    })),
  persistPanelWidths: () => savePanelWidths(get().panelWidths),
  resetPanelWidth: (panel) => {
    get().setPanelWidth(panel, DEFAULT_PANEL_WIDTHS[panel])
    get().persistPanelWidths()
  },
  reclampPanelWidths: () => {
    const { panelWidths, setPanelWidth } = get()
    setPanelWidth('folders', panelWidths.folders)
    setPanelWidth('pages', get().panelWidths.pages)
  },
}))
