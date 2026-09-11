// Ink tool state — DESIGN.md §5.5. Separate from `uiStore` (ribbon chrome)
// and `canvasStore` (segments) since it's neither: it's what the Draw tab's
// ribbon panel and `InkLayer` both need to agree on (current tool/colour/
// width) without prop-drilling between two components that don't otherwise
// share a parent close enough for that.
import { create } from 'zustand'

export const INK_TOOLS = ['pen', 'marker', 'eraser'] as const
export type InkTool = (typeof INK_TOOLS)[number]

export const INK_COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#d97706'] as const

/** Per-tool default stroke width (px, before devicePixelRatio scaling) — markers are broader than pens. */
export const TOOL_WIDTH: Record<InkTool, number> = {
  pen: 2,
  marker: 10,
  eraser: 16,
}

interface InkState {
  tool: InkTool
  color: string
  setTool: (tool: InkTool) => void
  setColor: (color: string) => void
}

export const useInkStore = create<InkState>((set) => ({
  tool: 'pen',
  color: INK_COLORS[0],
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
}))
