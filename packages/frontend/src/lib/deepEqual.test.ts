import { describe, expect, it } from 'vitest'
import { deepEqual } from './deepEqual'

describe('deepEqual', () => {
  it('ignores key order and undefined fields', () => {
    expect(deepEqual({ type: 'doc', content: [{ type: 'p', attrs: { a: 1 } }] }, { content: [{ attrs: { a: 1 }, type: 'p' }], type: 'doc' })).toBe(true)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('tells different values apart', () => {
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: '1' })).toBe(false)
    expect(deepEqual([], {})).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})
