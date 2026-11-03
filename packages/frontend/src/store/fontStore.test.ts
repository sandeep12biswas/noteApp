import { beforeEach, describe, expect, it } from 'vitest'
import { FONT_FAMILIES } from '../lib/fontFamilies'
import { readStoredFont, useFontStore } from './fontStore'

const STORAGE_KEY = 'flownote:defaultFont'

beforeEach(() => {
  localStorage.clear()
  useFontStore.setState({ defaultFont: '' })
})

describe('setDefaultFont', () => {
  it('persists a valid font family value', () => {
    const inter = FONT_FAMILIES.find((f) => f.label === 'Inter')!.value
    useFontStore.getState().setDefaultFont(inter)
    expect(useFontStore.getState().defaultFont).toBe(inter)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(inter)
  })

  it('persists "Default" (empty value) to clear the preference', () => {
    useFontStore.getState().setDefaultFont('Georgia, serif')
    useFontStore.getState().setDefaultFont('')
    expect(useFontStore.getState().defaultFont).toBe('')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('')
  })
})

describe('readStoredFont', () => {
  it('falls back to "" for a value not in FONT_FAMILIES (e.g. a stale/foreign key)', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-real-font')
    expect(readStoredFont()).toBe('')
  })

  it('returns a stored value that matches a known FONT_FAMILIES entry', () => {
    const lora = FONT_FAMILIES.find((f) => f.label === 'Lora')!.value
    localStorage.setItem(STORAGE_KEY, lora)
    expect(readStoredFont()).toBe(lora)
  })
})
