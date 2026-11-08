import { beforeEach, describe, expect, it } from 'vitest'
import { effectiveBackground, normalizeBackground, useEditorBackgroundStore } from './editorBackgroundStore'

beforeEach(() => {
  localStorage.clear()
  useEditorBackgroundStore.setState({ defaultBackground: null })
})

describe('editorBackgroundStore (issue #11)', () => {
  it('the effective colour is the page colour, else the default, else none', () => {
    expect(effectiveBackground('#f8f1e3', '#ecfdf5')).toBe('#f8f1e3')
    expect(effectiveBackground(null, '#ecfdf5')).toBe('#ecfdf5')
    expect(effectiveBackground(undefined, null)).toBeNull()
  })

  it('ignores a page colour that is not #rrggbb', () => {
    expect(effectiveBackground('red', '#ecfdf5')).toBe('#ecfdf5')
  })

  it('normalizes to lower-case #rrggbb', () => {
    expect(normalizeBackground('#F8F1E3')).toBe('#f8f1e3')
    expect(normalizeBackground('#fff')).toBeNull()
    expect(normalizeBackground(null)).toBeNull()
  })

  it('persists the default per device and clears it with null', () => {
    useEditorBackgroundStore.getState().setDefaultBackground('#EFF6FF')
    expect(useEditorBackgroundStore.getState().defaultBackground).toBe('#eff6ff')
    expect(localStorage.getItem('flownote:editor-background')).toBe('#eff6ff')

    useEditorBackgroundStore.getState().setDefaultBackground(null)
    expect(useEditorBackgroundStore.getState().defaultBackground).toBeNull()
    expect(localStorage.getItem('flownote:editor-background')).toBeNull()
  })
})
