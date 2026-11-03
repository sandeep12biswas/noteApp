import { describe, expect, it } from 'vitest'
import { contrastRatio, HIGHLIGHT_COLORS, readableTextOn } from './textColors'

describe('readableTextOn (issue #6)', () => {
  it('gives every highlight preset near-black text with at least WCAG AA contrast', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(readableTextOn(color)).toBe('#111827')
      expect(contrastRatio(color, '#111827')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives dark highlights near-white text', () => {
    expect(readableTextOn('#1e3a8a')).toBe('#f9fafb')
    expect(readableTextOn('#000')).toBe('#f9fafb')
    expect(readableTextOn('rgb(30, 58, 138)')).toBe('#f9fafb')
  })

  it('reads #rgb, #rrggbb(aa) and rgb()/rgba()', () => {
    expect(readableTextOn('#ff0')).toBe('#111827')
    expect(readableTextOn('#FEF08A')).toBe('#111827')
    expect(readableTextOn('#fef08aff')).toBe('#111827')
    expect(readableTextOn('rgba(254, 240, 138, 1)')).toBe('#111827')
  })

  it('returns null for colours it cannot read, so the text keeps its own colour', () => {
    expect(readableTextOn('yellow')).toBeNull()
    expect(readableTextOn('oklch(0.9 0.1 100)')).toBeNull()
  })
})
