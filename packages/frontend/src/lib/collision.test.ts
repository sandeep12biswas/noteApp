import { describe, expect, it } from 'vitest'
import {
  clampResizeWidth,
  findFreePosition,
  GAP_HIGHLIGHT_THRESHOLD,
  gapLineFor,
  idsWithinGap,
  MIN_GAP,
  MIN_SEGMENT_WIDTH,
  overlaps,
  resolvePosition,
} from './collision'

describe('overlaps', () => {
  it('is false for boxes far apart', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 })).toBe(false)
  })

  it('is true for boxes that touch exactly', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(true)
  })

  it('is true when boxes are within the minimum gap', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10 + MIN_GAP - 1, y: 0, w: 10, h: 10 })).toBe(true)
  })

  it('is false when boxes are exactly the minimum gap apart', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10 + MIN_GAP, y: 0, w: 10, h: 10 })).toBe(false)
  })
})

describe('findFreePosition', () => {
  it('returns the requested point when nothing else is there', () => {
    expect(findFreePosition(20, 30, 100, 50, [])).toEqual({ x: 20, y: 30 })
  })

  it('nudges down past a colliding box', () => {
    const existing = [{ x: 0, y: 0, w: 200, h: 40 }]
    const result = findFreePosition(0, 0, 200, 40, existing)
    expect(result.x).toBe(0)
    expect(result.y).toBeGreaterThanOrEqual(40 + MIN_GAP)
    expect(overlaps({ ...result, w: 200, h: 40 }, existing[0]!)).toBe(false)
  })

  it('skips past multiple stacked boxes', () => {
    const existing = [
      { x: 0, y: 0, w: 100, h: 30 },
      { x: 0, y: 38, w: 100, h: 30 },
    ]
    const result = findFreePosition(0, 0, 100, 30, existing)
    for (const box of existing) {
      expect(overlaps({ ...result, w: 100, h: 30 }, box)).toBe(false)
    }
  })
})

describe('resolvePosition', () => {
  it('returns the requested position when nothing else is there', () => {
    expect(resolvePosition({ x: 20, y: 30, w: 100, h: 50 }, [])).toEqual({ x: 20, y: 30 })
  })

  it('pushes out along the axis needing the smaller correction', () => {
    // Dragged box mostly clear horizontally, just grazing vertically —
    // should resolve by nudging up/down, not sideways.
    const existing = [{ x: 0, y: 0, w: 100, h: 100 }]
    const moving = { x: 90, y: 95, w: 50, h: 50 } // overlaps by 15 in y, would need 65 in x
    const result = resolvePosition(moving, existing)
    expect(result.x).toBe(90) // unchanged
    expect(overlaps({ ...result, w: 50, h: 50 }, existing[0]!)).toBe(false)
  })

  it('never returns negative coordinates', () => {
    const existing = [{ x: 0, y: 0, w: 100, h: 100 }]
    const result = resolvePosition({ x: 5, y: 5, w: 50, h: 50 }, existing)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
  })

  it('resolves clear of every box when dropped into a gap between two', () => {
    const existing = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 150, w: 100, h: 50 },
    ]
    const result = resolvePosition({ x: 10, y: 45, w: 80, h: 30 }, existing)
    for (const box of existing) {
      expect(overlaps({ ...result, w: 80, h: 30 }, box)).toBe(false)
    }
  })

  it('is idempotent on an already-clear position', () => {
    const existing = [{ x: 0, y: 0, w: 100, h: 100 }]
    const clear = { x: 200, y: 200, w: 50, h: 50 }
    expect(resolvePosition(clear, existing)).toEqual({ x: 200, y: 200 })
  })
})

describe('clampResizeWidth', () => {
  it('allows the proposed width when nothing is in the way', () => {
    expect(clampResizeWidth({ x: 0, y: 0, h: 40 }, 300, [])).toBe(300)
  })

  it('clamps growth against a neighbour to its right', () => {
    const existing = [{ x: 400, y: 0, w: 100, h: 40 }]
    const result = clampResizeWidth({ x: 0, y: 0, h: 40 }, 500, existing)
    expect(result).toBe(400 - MIN_GAP)
  })

  it('ignores a neighbour that does not vertically overlap', () => {
    const existing = [{ x: 200, y: 500, w: 100, h: 40 }]
    expect(clampResizeWidth({ x: 0, y: 0, h: 40 }, 500, existing)).toBe(500)
  })

  it('ignores a neighbour entirely to the left', () => {
    const existing = [{ x: -200, y: 0, w: 100, h: 40 }]
    expect(clampResizeWidth({ x: 0, y: 0, h: 40 }, 500, existing)).toBe(500)
  })

  it('never clamps below the minimum segment width', () => {
    const existing = [{ x: 10, y: 0, w: 100, h: 40 }]
    const result = clampResizeWidth({ x: 0, y: 0, h: 40 }, 500, existing)
    expect(result).toBe(MIN_SEGMENT_WIDTH)
  })
})

describe('idsWithinGap', () => {
  it('returns ids of boxes within the threshold', () => {
    const box = { x: 0, y: 0, w: 100, h: 40 }
    const others = [
      { id: 'near', x: 100 + GAP_HIGHLIGHT_THRESHOLD - 1, y: 0, w: 50, h: 40 },
      { id: 'far', x: 500, y: 500, w: 50, h: 40 },
    ]
    expect(idsWithinGap(box, others)).toEqual(['near'])
  })

  it('excludes a box exactly at the threshold boundary plus one', () => {
    const box = { x: 0, y: 0, w: 100, h: 40 }
    const others = [{ id: 'just-out', x: 100 + GAP_HIGHLIGHT_THRESHOLD + 1, y: 0, w: 50, h: 40 }]
    expect(idsWithinGap(box, others)).toEqual([])
  })

  it('includes overlapping boxes (gap of 0)', () => {
    const box = { x: 0, y: 0, w: 100, h: 40 }
    const others = [{ id: 'overlapping', x: 50, y: 0, w: 50, h: 40 }]
    expect(idsWithinGap(box, others)).toEqual(['overlapping'])
  })
})

describe('gapLineFor', () => {
  it('draws a vertical line at the midpoint of a horizontal gap, spanning the y-overlap', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    const b = { x: 110, y: 10, w: 50, h: 40 } // 10px gap to the right, y-ranges overlap [10, 40]
    const line = gapLineFor(a, b)
    expect(line).toEqual({ x: 105, y: 10, w: 0, h: 30, orientation: 'vertical' })
  })

  it('is symmetric regardless of argument order', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    const b = { x: 110, y: 10, w: 50, h: 40 }
    expect(gapLineFor(b, a)).toEqual(gapLineFor(a, b))
  })

  it('draws a horizontal line at the midpoint of a vertical gap, spanning the x-overlap', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    const b = { x: 20, y: 50, w: 100, h: 40 } // 10px gap below, x-ranges overlap [20, 100]
    const line = gapLineFor(a, b)
    expect(line).toEqual({ x: 20, y: 45, w: 80, h: 0, orientation: 'horizontal' })
  })

  it('returns null for diagonally/corner-separated boxes (no single unambiguous line)', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    const b = { x: 110, y: 50, w: 50, h: 40 } // gap on both axes
    expect(gapLineFor(a, b)).toBeNull()
  })

  it('returns null for overlapping boxes (no gap to draw)', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    const b = { x: 50, y: 0, w: 50, h: 40 }
    expect(gapLineFor(a, b)).toBeNull()
  })
})
