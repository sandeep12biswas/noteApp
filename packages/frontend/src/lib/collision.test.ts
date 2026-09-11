import { describe, expect, it } from 'vitest'
import { findFreePosition, MIN_GAP, overlaps } from './collision'

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
