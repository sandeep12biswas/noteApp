// Widths of the two resizable side panels — folders (SectionSidebar) and
// pages (PageList). The editor takes whatever is left (DESIGN.md §2: all
// three vertical panels are mouse-drag resizable; dragging a side panel's
// edge trades width with the editor).
//
// Remembered across restarts in `localStorage` — a per-device UI
// preference, same reasoning and same try/catch guarding as
// lastOpenedPage.ts: storage can throw (private window, cleared or
// locked-down storage) and losing this convenience must never break the app.

export type ResizablePanel = 'folders' | 'pages'
export type PanelWidths = Record<ResizablePanel, number>

/** Today's fixed widths (Tailwind `w-40` and `w-[170px]` before this). */
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { folders: 160, pages: 170 }
export const MIN_PANEL_WIDTH = 120
export const MAX_PANEL_WIDTH = 480
/** However the side panels are sized, the editor keeps at least this much. */
export const MIN_EDITOR_WIDTH = 320

const KEY = 'flownote:panelWidths'

/**
 * Clamps `width` for `panel` to [MIN_PANEL_WIDTH, MAX_PANEL_WIDTH], and so
 * the editor keeps MIN_EDITOR_WIDTH given the other panel's width and the
 * window width (`otherWidth` is 0 when the other panel isn't shown). The
 * minimum wins if the window is too narrow for both.
 */
export function clampPanelWidth(width: number, otherWidth: number, windowWidth: number): number {
  const roomLeft = windowWidth - otherWidth - MIN_EDITOR_WIDTH
  const max = Math.min(MAX_PANEL_WIDTH, roomLeft)
  return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(width, max)))
}

export function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PANEL_WIDTHS }
    const parsed: unknown = JSON.parse(raw)
    const widths = { ...DEFAULT_PANEL_WIDTHS }
    if (typeof parsed === 'object' && parsed !== null) {
      for (const panel of ['folders', 'pages'] as const) {
        const w = (parsed as Record<string, unknown>)[panel]
        if (typeof w === 'number' && Number.isFinite(w)) {
          widths[panel] = Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, w)))
        }
      }
    }
    return widths
  } catch {
    return { ...DEFAULT_PANEL_WIDTHS }
  }
}

export function savePanelWidths(widths: PanelWidths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(widths))
  } catch {
    // best-effort — see module doc
  }
}
