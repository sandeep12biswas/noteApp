import { describe, expect, it } from 'vitest'
import { makeId } from './ids'

describe('makeId', () => {
  it('keeps the prefix and adds a UUID, so ids from different devices never meet', () => {
    const a = makeId('segment')
    expect(a).toMatch(/^segment-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(makeId('segment')).not.toBe(a)
  })
})
