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
