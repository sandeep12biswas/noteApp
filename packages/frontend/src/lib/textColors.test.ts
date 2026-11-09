import { describe, expect, it } from 'vitest'
import { adjustForContrast, contrastRatio, CONTRAST_LOW, CONTRAST_TEXT, editorInk, HIGHLIGHT_COLORS, isLowContrast, readableTextOn, suggestTextColors } from './textColors'
import { PAGE_BACKGROUND_PRESETS } from '../store/editorBackgroundStore'

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

describe('editorInk (issue #12)', () => {
  const backgrounds = [
    ...PAGE_BACKGROUND_PRESETS.map((p) => p.color),
    '#000000', // black
    '#1e3a8a', // navy
    '#777777', // mid-grey
    '#dc2626', // saturated red
  ]

  it.each(backgrounds)('reaches 4.5:1 for text and muted text and 3:1 for borders on %s', (bg) => {
    const ink = editorInk(bg)
    expect(contrastRatio(ink.text, bg)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
    expect(contrastRatio(ink.muted, bg)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
    expect(contrastRatio(ink.border, bg)).toBeGreaterThanOrEqual(CONTRAST_LOW)
  })

  it('uses near-black on light backgrounds and near-white on dark ones', () => {
    expect(editorInk('#f8f1e3').text).toBe('#111827')
    expect(editorInk('#1e3a8a').text).toBe('#f9fafb')
  })

  it('makes muted text and borders softer than the text', () => {
    const ink = editorInk('#ffffff')
    expect(contrastRatio(ink.muted, '#ffffff')).toBeLessThan(contrastRatio(ink.text, '#ffffff'))
    expect(contrastRatio(ink.border, '#ffffff')).toBeLessThan(contrastRatio(ink.muted, '#ffffff'))
  })
})

/** Hue in degrees, for checking that adjustForContrast keeps it. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}

describe('adjustForContrast (issue #12)', () => {
  it('leaves a colour that already reads well alone', () => {
    expect(adjustForContrast('#1d4ed8', '#ffffff')).toBe('#1d4ed8')
  })

  it.each([
    ['#2563eb', '#1e3a8a'], // blue on navy → lighter blue
    ['#16a34a', '#000000'], // green on black
    ['#fde047', '#ffffff'], // yellow on white → darker yellow
    ['#dc2626', '#777777'], // red on mid-grey
  ])('keeps the hue of %s and reaches 4.5:1 on %s', (color, bg) => {
    const adjusted = adjustForContrast(color, bg)
    expect(contrastRatio(adjusted, bg)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
    expect(Math.abs(hue(adjusted) - hue(color))).toBeLessThan(6)
  })

  it('falls back to the ordinary text colour when no shade of the hue gets there', () => {
    // Any shade of grey on mid-grey: lightness alone can't reach 7:1 from #777 upwards… but
    // white can't either, so it ends on the ink colour.
    expect(adjustForContrast('#808080', '#777777', 7)).toBe(editorInk('#777777').text)
  })
})

describe('suggestTextColors (issue #12)', () => {
  it.each(['#1e3a8a', '#f8f1e3', '#000000', '#dc2626'])('offers 4 distinct colours that all read well on %s', (bg) => {
    const suggested = suggestTextColors(bg)
    expect(suggested).toHaveLength(4)
    expect(new Set(suggested).size).toBe(4)
    for (const c of suggested) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(CONTRAST_TEXT)
  })
})

describe('isLowContrast (issue #12)', () => {
  it('flags colours below 3:1', () => {
    expect(isLowContrast('#2563eb', '#1e3a8a')).toBe(true)
    expect(isLowContrast('#111827', '#ffffff')).toBe(false)
    expect(isLowContrast('not a colour', '#ffffff')).toBe(false)
  })
})
