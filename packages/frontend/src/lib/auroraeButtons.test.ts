import { describe, expect, it } from 'vitest'
import { artFor, buildButtonArt, cropState, type Measure } from './auroraeButtons'

// Two states side by side, the way Aurorae themes lay them out.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
  <script>alert(1)</script>
  <g id="active-center" onclick="evil()"><circle cx="10" cy="10" r="8" fill="#f00"/></g>
  <g id="hover-center"><circle cx="40" cy="10" r="8" fill="#f80"/></g>
</svg>`

// jsdom has no layout; pretend each state is a 16x16 box at its circle.
const fakeMeasure: Measure = (_root, el) => (el.id === 'active-center' ? { x: 2, y: 2, width: 16, height: 16 } : { x: 32, y: 2, width: 16, height: 16 })

function decode(url: string): string {
  return decodeURIComponent(url.replace('data:image/svg+xml;charset=utf-8,', ''))
}

describe('Aurorae button art', () => {
  it("crops the file to one state's box and drops the other states", () => {
    const svg = decode(cropState(SVG, 'active', fakeMeasure)!)
    expect(svg).toContain('viewBox="2 2 16 16"')
    expect(svg).toContain('id="active-center"')
    expect(svg).not.toContain('hover-center')
  })

  it('strips scripts and event handlers', () => {
    const svg = decode(cropState(SVG, 'active', fakeMeasure)!)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('onclick')
  })

  it('returns null for a state the theme does not have, or a file that is not SVG', () => {
    expect(cropState(SVG, 'pressed', fakeMeasure)).toBeNull()
    expect(cropState('<html/>', 'active', fakeMeasure)).toBeNull()
    expect(cropState('not xml', 'active', fakeMeasure)).toBeNull()
  })

  it('falls back like KWin when a state is missing (pressed → hover → active)', () => {
    const art = buildButtonArt({ kind: 'aurorae', name: 't', svgs: { close: SVG, minimize: SVG, maximize: SVG, restore: SVG }, buttonWidth: 16, buttonHeight: 16, spacing: 4, edge: 8 }, fakeMeasure)
    expect(artFor(art, 'close', 'pressed')).toBe(art.close.hover)
    expect(artFor(art, 'close', 'inactive')).toBe(art.close.active)
  })
})
