import { describe, expect, it } from 'vitest'
import { capitalizeFirstLetter, validateFileName } from './validation'

describe('capitalizeFirstLetter', () => {
  it('capitalizes an all-lowercase name', () => {
    expect(capitalizeFirstLetter('projects')).toBe('Projects')
  })

  it('leaves an already-capitalized name unchanged', () => {
    expect(capitalizeFirstLetter('Projects')).toBe('Projects')
  })

  it('only touches the first letter', () => {
    expect(capitalizeFirstLetter('my notes')).toBe('My notes')
  })

  it('handles an empty string without throwing', () => {
    expect(capitalizeFirstLetter('')).toBe('')
  })

  it('handles a name starting with a non-letter', () => {
    expect(capitalizeFirstLetter('1st drafts')).toBe('1st drafts')
  })
})

describe('validateFileName', () => {
  it('accepts a name starting with a capital letter', () => {
    expect(validateFileName('Meeting Notes')).toEqual({ valid: true })
  })

  it('rejects a name starting with a digit', () => {
    expect(validateFileName('1st Draft').valid).toBe(false)
  })

  it('rejects a name starting with a special character', () => {
    expect(validateFileName('#urgent').valid).toBe(false)
  })

  it('rejects a name starting with a lowercase letter', () => {
    expect(validateFileName('untitled').valid).toBe(false)
  })

  it('rejects an empty name', () => {
    expect(validateFileName('').valid).toBe(false)
  })

  it('rejects a whitespace-only name', () => {
    expect(validateFileName('   ').valid).toBe(false)
  })
})
