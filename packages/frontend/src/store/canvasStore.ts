// Canvas/segment state — DESIGN.md §7.1 `CanvasStore`, §4.1 (invisible
// segment model). Reducers stay synchronous and are the source of truth for
// local state; each mutation additionally fires an IPCAdapter call to
// persist to real SQLite storage ("IPCAdapter calls wired",
// EXECUTION_PLAN.md Phase 2) — fire-and-forget, same pattern as
// notebookStore.ts. `editorRefs` is a plain (non-reactive) map mutated
// outside `set()`, matching DESIGN.md §7.1's `Map<string, Editor>` and
// §8.2's ribbon-dispatch-via-`getActiveEditor()` plan — it deliberately
// doesn't trigger re-renders.
import type { IPCAdapter } from '@flownote/ipc-adapter'
import type { Editor } from '@tiptap/react'
import { create } from 'zustand'
import type { AABB } from '../lib/collision'

let ipc: IPCAdapter | null = null

/** Called once at startup (App.tsx) once `resolveIPCAdapter()` settles. */
export function setIPCAdapter(adapter: IPCAdapter | null): void {
  ipc = adapter
}

function persist(label: string, promise: Promise<unknown> | undefined): void {
  promise?.catch((err: unknown) => {
    // eslint-disable-next-line no-console -- best-effort persistence; nothing else observes this failure yet
    console.error(`canvasStore: ${label} failed`, err)
  })
}

function toWireSegment(s: Segment): Omit<Segment, 'createdAt' | 'updatedAt'> {
  const { id, pageId, x, y, w, h, zIndex, borderColor, fillColor, content } = s
  return { id, pageId, x, y, w, h, zIndex, borderColor, fillColor, content }
}

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
  /** Loads a page's persisted segments from IPCAdapter, replacing any in-memory ones for that page. */
  loadSegmentsForPage: (pageId: string) => Promise<void>
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
    persist('saveSegment', ipc?.saveSegment(toWireSegment(segment)))
    return id
  },

  setActiveSegment: (id) => set({ activeSegmentId: id }),

  updateSegmentContent: (id, content) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      const updated = { ...seg, content, updatedAt: Date.now() }
      persist('saveSegment', ipc?.saveSegment(toWireSegment(updated)))
      return { segments: { ...state.segments, [id]: updated } }
    }),

  updateSegmentHeight: (id, h) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg || seg.h === h) return state
      const updated = { ...seg, h, updatedAt: Date.now() }
      persist('saveSegment', ipc?.saveSegment(toWireSegment(updated)))
      return { segments: { ...state.segments, [id]: updated } }
    }),

  setSegmentColor: (id, borderColor, fillColor) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      const updated = { ...seg, borderColor, fillColor, updatedAt: Date.now() }
      persist('saveSegment', ipc?.saveSegment(toWireSegment(updated)))
      return { segments: { ...state.segments, [id]: updated } }
    }),

  deleteIfEmptyAndUncolored: (id) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      if (seg.borderColor !== null) return state
      if (!isEmptyDoc(seg.content)) return state
      const rest = { ...state.segments }
      delete rest[id]
      persist('deleteSegment', ipc?.deleteSegment(id))
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

  loadSegmentsForPage: async (pageId) => {
    if (!ipc) return
    const loaded = await ipc.listSegments(pageId)
    const now = Date.now()
    set((state) => {
      const kept = Object.fromEntries(Object.entries(state.segments).filter(([, s]) => s.pageId !== pageId))
      for (const s of loaded) {
        kept[s.id] = { ...s, createdAt: now, updatedAt: now }
      }
      return { segments: kept }
    })
  },
}))
