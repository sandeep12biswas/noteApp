// Canvas/segment state — DESIGN.md §7.1 `CanvasStore`, §4.1 (invisible
// segment model). Client-side only for now, keyed by pageId (here, the
// selected file's id from `notebookStore`) — wiring `saveSegment`/
// `saveSegmentsBatch`/`deleteSegment` through IPCAdapter is the separate
// "IPCAdapter calls wired" task. `editorRefs` is a plain (non-reactive) map
// mutated outside `set()`, matching DESIGN.md §7.1's `Map<string, Editor>`
// and §8.2's ribbon-dispatch-via-`getActiveEditor()` plan — it deliberately
// doesn't trigger re-renders.
import type { Editor } from '@tiptap/react'
import { create } from 'zustand'
import type { AABB } from '../lib/collision'

export interface Segment {
  id: string
  pageId: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  borderColor: string | null
  fillColor: string | null
  /** TipTap JSON document, serialised. Empty-doc default until content is typed. */
  content: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export const DEFAULT_SEGMENT_WIDTH = 320
export const DEFAULT_SEGMENT_HEIGHT = 80

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

function isEmptyDoc(content: Record<string, unknown>): boolean {
  const nodes = (content as { content?: unknown[] }).content ?? []
  if (nodes.length === 0) return true
  if (nodes.length === 1) {
    const only = nodes[0] as { content?: unknown[] }
    return !only.content || only.content.length === 0
  }
  return false
}

interface CanvasState {
  segments: Record<string, Segment>
  activeSegmentId: string | null
  editorRefs: Map<string, Editor>

  segmentsForPage: (pageId: string) => Segment[]
  aabbsForPage: (pageId: string, excludeId?: string) => AABB[]

  createSegment: (pageId: string, x: number, y: number, w?: number, h?: number) => string
  setActiveSegment: (id: string | null) => void
  updateSegmentContent: (id: string, content: Record<string, unknown>) => void
  updateSegmentHeight: (id: string, h: number) => void
  setSegmentColor: (id: string, borderColor: string | null, fillColor: string | null) => void
  /** Auto-delete rule (DESIGN.md §4.1/§4.2): empty segments vanish on blur unless coloured. */
  deleteIfEmptyAndUncolored: (id: string) => void
  registerEditor: (id: string, editor: Editor) => void
  unregisterEditor: (id: string) => void
  getActiveEditor: () => Editor | null
}

let nextSegmentId = 1
function makeSegmentId(): string {
  return `segment-${nextSegmentId++}`
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  segments: {},
  activeSegmentId: null,
  editorRefs: new Map(),

  segmentsForPage: (pageId) => Object.values(get().segments).filter((s) => s.pageId === pageId),

  aabbsForPage: (pageId, excludeId) =>
    get()
      .segmentsForPage(pageId)
      .filter((s) => s.id !== excludeId)
      .map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),

  createSegment: (pageId, x, y, w = DEFAULT_SEGMENT_WIDTH, h = DEFAULT_SEGMENT_HEIGHT) => {
    const id = makeSegmentId()
    const now = Date.now()
    const segment: Segment = {
      id,
      pageId,
      x,
      y,
      w,
      h,
      zIndex: Object.keys(get().segments).length,
      borderColor: null,
      fillColor: null,
      content: EMPTY_DOC,
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({ segments: { ...state.segments, [id]: segment }, activeSegmentId: id }))
    return id
  },

  setActiveSegment: (id) => set({ activeSegmentId: id }),

  updateSegmentContent: (id, content) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      return { segments: { ...state.segments, [id]: { ...seg, content, updatedAt: Date.now() } } }
    }),

  updateSegmentHeight: (id, h) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg || seg.h === h) return state
      return { segments: { ...state.segments, [id]: { ...seg, h, updatedAt: Date.now() } } }
    }),

  setSegmentColor: (id, borderColor, fillColor) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      return { segments: { ...state.segments, [id]: { ...seg, borderColor, fillColor, updatedAt: Date.now() } } }
    }),

  deleteIfEmptyAndUncolored: (id) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      if (seg.borderColor !== null) return state
      if (!isEmptyDoc(seg.content)) return state
      const rest = { ...state.segments }
      delete rest[id]
      return {
        segments: rest,
        activeSegmentId: state.activeSegmentId === id ? null : state.activeSegmentId,
      }
    }),

  registerEditor: (id, editor) => {
    get().editorRefs.set(id, editor)
  },
  unregisterEditor: (id) => {
    get().editorRefs.delete(id)
  },
  getActiveEditor: () => {
    const activeId = get().activeSegmentId
    if (!activeId) return null
    return get().editorRefs.get(activeId) ?? null
  },
}))
