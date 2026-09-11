// Phase 3 collision system — drag/resize commits and the height-change
// cascade (DESIGN.md §4.6, §10 "ResizeObserver cascade loops").
import { beforeEach, describe, expect, it } from 'vitest'
import { overlaps } from '../lib/collision'
import { useCanvasStore } from './canvasStore'

beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
})

describe('updateSegmentPosition', () => {
  it('commits the new position', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().updateSegmentPosition(id, 50, 60)
    const seg = useCanvasStore.getState().segments[id]
    expect(seg?.x).toBe(50)
    expect(seg?.y).toBe(60)
  })

  it('is a no-op for an unknown id', () => {
    expect(() => useCanvasStore.getState().updateSegmentPosition('missing', 1, 1)).not.toThrow()
  })
})

describe('updateSegmentWidth', () => {
  it('commits the new width', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().updateSegmentWidth(id, 500)
    expect(useCanvasStore.getState().segments[id]?.w).toBe(500)
  })
})

describe('setSegmentColor', () => {
  it('persists border and fill colour', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().setSegmentColor(id, '#dc2626', 'rgba(220, 38, 38, 0.08)')
    const seg = useCanvasStore.getState().segments[id]
    expect(seg?.borderColor).toBe('#dc2626')
    expect(seg?.fillColor).toBe('rgba(220, 38, 38, 0.08)')
  })

  it('clears both colours when passed null', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().setSegmentColor(id, '#dc2626', 'rgba(220, 38, 38, 0.08)')
    useCanvasStore.getState().setSegmentColor(id, null, null)
    const seg = useCanvasStore.getState().segments[id]
    expect(seg?.borderColor).toBeNull()
    expect(seg?.fillColor).toBeNull()
  })
})

describe('deleteIfEmptyAndUncolored (DESIGN.md §4.2 "coloured segments never auto-delete")', () => {
  it('deletes an empty, uncoloured segment', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().deleteIfEmptyAndUncolored(id)
    expect(useCanvasStore.getState().segments[id]).toBeUndefined()
  })

  it('keeps an empty segment once it has been given a colour', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().setSegmentColor(id, '#dc2626', 'rgba(220, 38, 38, 0.08)')
    useCanvasStore.getState().deleteIfEmptyAndUncolored(id)
    expect(useCanvasStore.getState().segments[id]).toBeDefined()
  })

  it('keeps a non-empty segment regardless of colour', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().updateSegmentContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] })
    useCanvasStore.getState().deleteIfEmptyAndUncolored(id)
    expect(useCanvasStore.getState().segments[id]).toBeDefined()
  })
})

describe('updateSegmentHeight cascade', () => {
  it('does not push anything when nothing overlaps', () => {
    const a = useCanvasStore.getState().createSegment('page-1', 0, 0, 200, 40)
    const b = useCanvasStore.getState().createSegment('page-1', 0, 500, 200, 40)
    useCanvasStore.getState().updateSegmentHeight(a, 60)
    expect(useCanvasStore.getState().segments[b]?.y).toBe(500)
  })

  it('pushes a directly-overlapping segment down to clear the gap', () => {
    const a = useCanvasStore.getState().createSegment('page-1', 0, 0, 200, 40)
    const b = useCanvasStore.getState().createSegment('page-1', 0, 44, 200, 40) // just past the 8px gap at h=40

    useCanvasStore.getState().updateSegmentHeight(a, 100) // grows past b's current position

    const segA = useCanvasStore.getState().segments[a]!
    const segB = useCanvasStore.getState().segments[b]!
    expect(overlaps(segA, segB)).toBe(false)
    expect(segB.y).toBeGreaterThanOrEqual(segA.y + segA.h + 8)
  })

  it('cascades through a chain of stacked segments', () => {
    const a = useCanvasStore.getState().createSegment('page-1', 0, 0, 200, 40)
    const b = useCanvasStore.getState().createSegment('page-1', 0, 48, 200, 40)
    const c = useCanvasStore.getState().createSegment('page-1', 0, 96, 200, 40)

    useCanvasStore.getState().updateSegmentHeight(a, 200) // pushes b, which must then push c

    const segs = useCanvasStore.getState().segments
    expect(overlaps(segs[a]!, segs[b]!)).toBe(false)
    expect(overlaps(segs[b]!, segs[c]!)).toBe(false)
  })

  it('never pushes when the segment shrinks', () => {
    const a = useCanvasStore.getState().createSegment('page-1', 0, 0, 200, 100)
    const b = useCanvasStore.getState().createSegment('page-1', 0, 108, 200, 40)

    useCanvasStore.getState().updateSegmentHeight(a, 20)

    expect(useCanvasStore.getState().segments[b]?.y).toBe(108)
  })

  it('does not push a segment in a different column (no horizontal overlap)', () => {
    const a = useCanvasStore.getState().createSegment('page-1', 0, 0, 200, 40)
    const b = useCanvasStore.getState().createSegment('page-1', 300, 20, 200, 40)

    useCanvasStore.getState().updateSegmentHeight(a, 200)

    expect(useCanvasStore.getState().segments[b]?.y).toBe(20)
  })
})

describe('makeSegmentId cross-session uniqueness', () => {
  // Regression test for a real bug found via live QA (run-electron): ids
  // used to be a bare per-module-load counter ("segment-1", "segment-2", …),
  // so a segment created in a *fresh* app launch could collide with a
  // persisted id from an earlier session — and since React keys SegmentHost
  // by id, the already-mounted (stale) TipTap editor for the old segment
  // silently absorbed the new segment's keystrokes. Ids must carry a
  // per-module-load random component, not just be numeric.
  it('is not a bare numeric counter', () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    expect(id).not.toMatch(/^segment-\d+$/)
  })
})
