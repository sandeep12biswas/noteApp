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
import { type AABB, MIN_GAP, overlaps } from '../lib/collision'

/** Guard against runaway recursion (DESIGN.md §10 "ResizeObserver cascade loops"). */
const MAX_CASCADE_DEPTH = 20

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

/**
 * Debounced persistence for height-driven saves only (`updateSegmentHeight`
 * and `cascadePushBelow`) — every other mutation here still calls `persist`
 * directly, since a drag/resize/colour commit is already one discrete user
 * action, not a rapid-fire stream. A growing segment's `ResizeObserver`
 * fires once per layout tick while its content is still changing (e.g.
 * every character typed on a wrapping line), and each tick was previously
 * its own full `saveSegment`/`saveSegmentsBatch` round-trip — harmless
 * correctness-wise (each call did use that tick's own freshest state) but
 * needless IPC traffic, flagged as a real follow-up in EXECUTION_PLAN.md
 * Phase 3. Coalesces into one batch write `HEIGHT_SAVE_DEBOUNCE_MS` after
 * the last tick in a burst, always reading each segment's *current* store
 * state at flush time (not whatever was passed in when scheduled) so nothing
 * stale ever overwrites a newer in-memory value.
 */
const HEIGHT_SAVE_DEBOUNCE_MS = 100
const pendingHeightSaveIds = new Set<string>()
let heightSaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleHeightPersist(ids: Iterable<string>, getSegment: (id: string) => Segment | undefined): void {
  for (const id of ids) pendingHeightSaveIds.add(id)
  if (heightSaveTimer) clearTimeout(heightSaveTimer)
  heightSaveTimer = setTimeout(() => {
    heightSaveTimer = null
    const ids2 = [...pendingHeightSaveIds]
    pendingHeightSaveIds.clear()
    const segments = ids2.map(getSegment).filter((s): s is Segment => s !== undefined)
    if (segments.length === 0) return
    if (segments.length === 1) {
      persist('saveSegment', ipc?.saveSegment(toWireSegment(segments[0]!)))
    } else {
      persist('saveSegmentsBatch', ipc?.saveSegmentsBatch(segments.map(toWireSegment)))
    }
  }, HEIGHT_SAVE_DEBOUNCE_MS)
}

/** Test-only: lets tests observe a debounce firing without waiting HEIGHT_SAVE_DEBOUNCE_MS in real time (used together with vi.useFakeTimers()) and reset between tests so a left-over timer from one test can't fire into the next. */
export function __flushHeightSavesForTests(): void {
  if (heightSaveTimer) {
    clearTimeout(heightSaveTimer)
    heightSaveTimer = null
  }
  pendingHeightSaveIds.clear()
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

/**
 * "Empty" means every top-level node is a paragraph with nothing in it —
 * anything else (an atom block like a plugin's `pluginBlock`, a heading, a
 * list, ...) makes the segment non-empty regardless of whether it has its
 * own `content` array. A real bug found live via `e2e-electron`'s plugin
 * lifecycle suite: the old check only special-cased the single-top-level-
 * node case, and treated a node with no `content` field at all (true of
 * every atom node, since atoms don't have child content) the same as an
 * empty paragraph — so a segment holding only an inserted plugin block got
 * silently auto-deleted the moment it lost focus, same as a truly blank one.
 */
function isEmptyDoc(content: Record<string, unknown>): boolean {
  const nodes = (content as { content?: unknown[] }).content ?? []
  return nodes.every((n) => {
    const node = n as { type?: string; content?: unknown[] }
    return node.type === 'paragraph' && (!node.content || node.content.length === 0)
  })
}

interface CanvasState {
  segments: Record<string, Segment>
  activeSegmentId: string | null
  editorRefs: Map<string, Editor>
  /** Non-reactive, mirrors `editorRefs` — lets drag/resize gap-highlight other segments' DOM nodes directly (60fps, no re-render). */
  segmentEls: Map<string, HTMLElement>

  segmentsForPage: (pageId: string) => Segment[]
  aabbsForPage: (pageId: string, excludeId?: string) => AABB[]
  registerSegmentEl: (id: string, el: HTMLElement) => void
  unregisterSegmentEl: (id: string) => void

  createSegment: (pageId: string, x: number, y: number, w?: number, h?: number) => string
  setActiveSegment: (id: string | null) => void
  updateSegmentContent: (id: string, content: Record<string, unknown>) => void
  /** Content-driven height change (ResizeObserver) — cascades a push-down to anything now overlapping below. */
  updateSegmentHeight: (id: string, h: number) => void
  /** Drag commit — SegmentHost direct-DOM-mutates during the drag itself and calls this once on pointerup. */
  updateSegmentPosition: (id: string, x: number, y: number) => void
  /** Resize commit — same direct-mutate-during-drag, commit-on-release pattern as position. */
  updateSegmentWidth: (id: string, w: number) => void
  setSegmentColor: (id: string, borderColor: string | null, fillColor: string | null) => void
  /** Auto-delete rule (DESIGN.md §4.1/§4.2): empty segments vanish on blur unless coloured. */
  deleteIfEmptyAndUncolored: (id: string) => void
  registerEditor: (id: string, editor: Editor) => void
  unregisterEditor: (id: string) => void
  getActiveEditor: () => Editor | null
  /** Loads a page's persisted segments from IPCAdapter, replacing any in-memory ones for that page. */
  loadSegmentsForPage: (pageId: string) => Promise<void>
  /**
   * Pushes segments overlapping `id` downward just enough to clear it, then
   * recurses onto whatever they in turn now overlap (DESIGN.md §10
   * "ResizeObserver cascade loops"). `visited` guards against a cycle
   * feeding back into itself; `depth` is the independent hard cap.
   */
  cascadePushBelow: (id: string, visited: Set<string>, depth: number) => void
}

let nextSegmentId = 1
// A plain in-session counter (`segment-1`, `segment-2`, …) collides with a
// real persisted id from a *previous* session the moment this module
// reloads (every launch restarts the counter at 1) — found live via
// `run-electron`: a freshly clicked-into-existence segment reused an old
// segment's id, and since React keys `SegmentHost` by that id, the already-
// mounted TipTap editor for the old segment was never remounted, so typing
// into the "new" segment silently appended onto the old one's text. The
// counter still makes ids human-readable in tests/logs; salting with a
// per-module-load random suffix is enough to make them unique *across*
// sessions too, without switching to opaque UUIDs everywhere.
const sessionSalt = Math.random().toString(36).slice(2, 8)
function makeSegmentId(): string {
  return `segment-${sessionSalt}-${nextSegmentId++}`
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  segments: {},
  activeSegmentId: null,
  editorRefs: new Map(),
  segmentEls: new Map(),

  segmentsForPage: (pageId) => Object.values(get().segments).filter((s) => s.pageId === pageId),

  aabbsForPage: (pageId, excludeId) =>
    get()
      .segmentsForPage(pageId)
      .filter((s) => s.id !== excludeId)
      .map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),

  registerSegmentEl: (id, el) => {
    get().segmentEls.set(id, el)
  },
  unregisterSegmentEl: (id) => {
    get().segmentEls.delete(id)
  },

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

  updateSegmentHeight: (id, h) => {
    const before = get().segments[id]
    if (!before || before.h === h) return
    set((state) => {
      const seg = state.segments[id]
      if (!seg) return state
      const updated = { ...seg, h, updatedAt: Date.now() }
      return { segments: { ...state.segments, [id]: updated } }
    })
    scheduleHeightPersist([id], (segId) => get().segments[segId])
    // Only a growing segment can newly overlap something below it.
    if (h > before.h) get().cascadePushBelow(id, new Set([id]), 0)
  },

  updateSegmentPosition: (id, x, y) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg || (seg.x === x && seg.y === y)) return state
      const updated = { ...seg, x, y, updatedAt: Date.now() }
      persist('saveSegment', ipc?.saveSegment(toWireSegment(updated)))
      return { segments: { ...state.segments, [id]: updated } }
    }),

  updateSegmentWidth: (id, w) =>
    set((state) => {
      const seg = state.segments[id]
      if (!seg || seg.w === w) return state
      const updated = { ...seg, w, updatedAt: Date.now() }
      persist('saveSegment', ipc?.saveSegment(toWireSegment(updated)))
      return { segments: { ...state.segments, [id]: updated } }
    }),

  cascadePushBelow: (id, visited, depth) => {
    if (depth >= MAX_CASCADE_DEPTH) return
    const state = get()
    const seg = state.segments[id]
    if (!seg) return
    const segBox = { x: seg.x, y: seg.y, w: seg.w, h: seg.h }
    const pushed: Segment[] = []

    for (const other of state.segmentsForPage(seg.pageId)) {
      if (visited.has(other.id)) continue
      const otherBox = { x: other.x, y: other.y, w: other.w, h: other.h }
      if (!overlaps(segBox, otherBox)) continue
      const requiredY = segBox.y + segBox.h + MIN_GAP
      if (other.y >= requiredY) continue
      pushed.push({ ...other, y: requiredY, updatedAt: Date.now() })
    }

    if (pushed.length === 0) return
    set((s) => {
      const next = { ...s.segments }
      for (const p of pushed) next[p.id] = p
      return { segments: next }
    })
    scheduleHeightPersist(
      pushed.map((p) => p.id),
      (segId) => get().segments[segId],
    )

    for (const p of pushed) {
      visited.add(p.id)
      get().cascadePushBelow(p.id, visited, depth + 1)
    }
  },

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
