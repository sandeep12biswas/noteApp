import { describe, expect, it } from 'vitest'
import { naturalCompare, naturalSortBy } from './naturalSort'

describe('naturalCompare', () => {
  it('orders "Folder 2" before "Folder 10"', () => {
    expect(naturalCompare('Folder 2', 'Folder 10')).toBeLessThan(0)
  })

  it('is the inverse when arguments are swapped', () => {
    expect(naturalCompare('Folder 10', 'Folder 2')).toBeGreaterThan(0)
  })

  it('treats equal names as equal', () => {
    expect(naturalCompare('Notes', 'Notes')).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(naturalCompare('apple', 'Apple')).toBe(0)
  })

  it('falls back to plain comparison when there are no digits', () => {
    expect(naturalCompare('Apple', 'Banana')).toBeLessThan(0)
  })

  it('handles multiple numeric runs', () => {
    expect(naturalCompare('v1.2', 'v1.10')).toBeLessThan(0)
    expect(naturalCompare('v2.1', 'v1.10')).toBeGreaterThan(0)
  })
})

describe('naturalSortBy', () => {
  it('sorts a full folder-name list into natural order', () => {
    const names = ['Folder 10', 'Folder 1', 'Folder 2', 'folder 20']
    expect(naturalSortBy(names, (n) => n)).toEqual(['Folder 1', 'Folder 2', 'Folder 10', 'folder 20'])
  })

  it('does not mutate the input array', () => {
    const names = ['b', 'a']
    const sorted = naturalSortBy(names, (n) => n)
    expect(names).toEqual(['b', 'a'])
    expect(sorted).toEqual(['a', 'b'])
  })
})
