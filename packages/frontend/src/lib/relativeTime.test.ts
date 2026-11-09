import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

describe('relativeTime', () => {
  const now = Date.UTC(2026, 10, 9, 12, 0, 0)
  it('reads naturally', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now')
    expect(relativeTime(now + 5_000, now)).toBe('just now') // a clock a bit ahead
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago')
    expect(relativeTime(now - 25 * 60_000, now)).toBe('25 minutes ago')
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1 hour ago')
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe('5 hours ago')
    expect(relativeTime(now - 30 * 3_600_000, now)).toBe('yesterday')
    expect(relativeTime(now - 5 * 86_400_000, now)).toBe(new Date(now - 5 * 86_400_000).toLocaleDateString())
  })
})
