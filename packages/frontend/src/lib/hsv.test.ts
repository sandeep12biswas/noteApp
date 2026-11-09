import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex, parseHex } from './hsv'

describe('parseHex', () => {
  it('accepts short and long forms, with or without #', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc')
    expect(parseHex('abc')).toBe('#aabbcc')
    expect(parseHex(' 1E3A8A ')).toBe('#1e3a8a')
  })
  it('rejects anything else', () => {
    for (const bad of ['', '#12', '#12345', 'red', '#ggg000', '#1234567']) expect(parseHex(bad)).toBeNull()
  })
})

describe('HSV ⇄ hex', () => {
  it('converts the primaries and greys', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff')
    expect(hsvToHex({ h: 200, s: 0, v: 1 })).toBe('#ffffff')
    expect(hsvToHex({ h: 0, s: 0, v: 0 })).toBe('#000000')
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#808080').s).toBe(0)
  })
  it('round-trips arbitrary colours', () => {
    for (const hex of ['#1e3a8a', '#f8f1e3', '#ecfdf5', '#7f1d1d', '#fbcfe8', '#111827', '#abcdef']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    }
  })
})
