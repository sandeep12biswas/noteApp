import { describe, expect, it } from 'vitest'
import { SEGMENT_BORDER_COLORS, fillForBorder } from './segmentColors'

describe('SEGMENT_BORDER_COLORS', () => {
  it('has exactly 9 distinct colours (DESIGN.md §4.2)', () => {
    expect(SEGMENT_BORDER_COLORS.length).toBe(9)
    expect(new Set(SEGMENT_BORDER_COLORS).size).toBe(9)
  })
})

describe('fillForBorder', () => {
  it('derives an 8%-opacity rgba fill from the hex border colour', () => {
    expect(fillForBorder('#dc2626')).toBe('rgba(220, 38, 38, 0.08)')
  })

  it('produces a matching fill for every palette colour', () => {
    for (const border of SEGMENT_BORDER_COLORS) {
      expect(fillForBorder(border)).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.08\)$/)
    }
  })
})
