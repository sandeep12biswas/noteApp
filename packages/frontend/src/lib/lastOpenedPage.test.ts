import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLastOpenedPage, saveLastOpenedPage } from './lastOpenedPage'

beforeEach(() => {
  localStorage.clear()
})

describe('saveLastOpenedPage / loadLastOpenedPage', () => {
  it('round-trips a saved page', () => {
    saveLastOpenedPage('folder-1', 'file-1')
    expect(loadLastOpenedPage()).toEqual({ folderId: 'folder-1', fileId: 'file-1' })
  })

  it('returns null when nothing has been saved yet', () => {
    expect(loadLastOpenedPage()).toBeNull()
  })

  it('returns null for malformed stored JSON rather than throwing', () => {
    localStorage.setItem('flownote:lastOpenedPage', '{not json')
    expect(() => loadLastOpenedPage()).not.toThrow()
    expect(loadLastOpenedPage()).toBeNull()
  })

  it('returns null when the stored shape is missing expected fields', () => {
    localStorage.setItem('flownote:lastOpenedPage', JSON.stringify({ folderId: 'folder-1' }))
    expect(loadLastOpenedPage()).toBeNull()
  })

  it('saving never throws even if localStorage itself throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveLastOpenedPage('folder-1', 'file-1')).not.toThrow()
    spy.mockRestore()
  })

  it('loading never throws even if localStorage itself throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(() => loadLastOpenedPage()).not.toThrow()
    expect(loadLastOpenedPage()).toBeNull()
    spy.mockRestore()
  })

  it('a later save overwrites an earlier one', () => {
    saveLastOpenedPage('folder-1', 'file-1')
    saveLastOpenedPage('folder-2', 'file-2')
    expect(loadLastOpenedPage()).toEqual({ folderId: 'folder-2', fileId: 'file-2' })
  })
})
