// "Delete segment" with undo (issue #29): removed at once, deleted from
// storage only when the undo window closes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { setIPCAdapter, UNDO_DELETE_MS, useCanvasStore } from './canvasStore'

let ipc: IPCAdapter

beforeEach(() => {
  vi.useFakeTimers()
  ipc = {
    saveSegment: vi.fn().mockResolvedValue(undefined),
    saveSegmentsBatch: vi.fn().mockResolvedValue(undefined),
    deleteSegment: vi.fn().mockResolvedValue(undefined),
    listSegments: vi.fn().mockResolvedValue([]),
  } as unknown as IPCAdapter
  setIPCAdapter(ipc)
  useCanvasStore.setState({ segments: {}, activeSegmentId: null, recentlyDeleted: null })
})

afterEach(() => {
  useCanvasStore.getState().commitDeleteSegment()
  setIPCAdapter(null)
  vi.useRealTimers()
})

const store = () => useCanvasStore.getState()

/** A coloured segment with text: the kind auto-delete never removes. */
function seedSegment() {
  const id = store().createSegment('page-1', 10, 20)
  store().setSegmentColor(id, '#dc2626', 'rgba(220, 38, 38, 0.08)')
  store().updateSegmentContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep me' }] }] })
  return id
}

describe('deleteSegment', () => {
  it('removes any segment at once but only deletes it from storage when the undo window ends', () => {
    const id = seedSegment()
    store().deleteSegment(id)
    expect(store().segments[id]).toBeUndefined()
    expect(store().activeSegmentId).toBeNull()
    expect(store().recentlyDeleted?.id).toBe(id)
    expect(ipc.deleteSegment).not.toHaveBeenCalled()

    vi.advanceTimersByTime(UNDO_DELETE_MS)
    expect(ipc.deleteSegment).toHaveBeenCalledWith(id)
    expect(store().recentlyDeleted).toBeNull()
  })

  it('undo restores the segment exactly as it was, without touching storage', () => {
    const id = seedSegment()
    const before = store().segments[id]
    store().deleteSegment(id)
    vi.mocked(ipc.saveSegment).mockClear()

    store().undoDeleteSegment()
    expect(store().segments[id]).toEqual(before)
    expect(store().recentlyDeleted).toBeNull()
    vi.advanceTimersByTime(UNDO_DELETE_MS * 2)
    expect(ipc.deleteSegment).not.toHaveBeenCalled()
    expect(ipc.saveSegment).not.toHaveBeenCalled()
  })

  it('a second deletion makes the first one final; only the latest can be undone', () => {
    const a = seedSegment()
    const b = store().createSegment('page-1', 10, 400)
    store().deleteSegment(a)
    store().deleteSegment(b)
    expect(ipc.deleteSegment).toHaveBeenCalledWith(a)
    expect(ipc.deleteSegment).not.toHaveBeenCalledWith(b)
    store().undoDeleteSegment()
    expect(store().segments[b]).toBeDefined()
    expect(store().segments[a]).toBeUndefined()
  })

  it('commitDeleteSegment ends the window early', () => {
    const id = seedSegment()
    store().deleteSegment(id)
    store().commitDeleteSegment()
    expect(ipc.deleteSegment).toHaveBeenCalledWith(id)
    store().undoDeleteSegment() // nothing left to undo
    expect(store().segments[id]).toBeUndefined()
  })

  it('reloading the page during the undo window does not bring the segment back', async () => {
    const id = seedSegment()
    const wire = { ...store().segments[id]! }
    vi.mocked(ipc.listSegments).mockResolvedValue([wire])
    store().deleteSegment(id)
    await store().loadSegmentsForPage('page-1')
    expect(store().segments[id]).toBeUndefined()
    await store().applyRemoteSegments('page-1')
    expect(store().segments[id]).toBeUndefined()
  })

  it('undo pushes down a segment placed where the deleted one was', () => {
    const id = seedSegment()
    const { y, h } = store().segments[id]!
    store().deleteSegment(id)
    const newcomer = store().createSegment('page-1', 10, 20)
    store().undoDeleteSegment()
    expect(store().segments[newcomer]!.y).toBeGreaterThanOrEqual(y + h)
  })

  it('closing the window commits a pending deletion', () => {
    const id = seedSegment()
    store().deleteSegment(id)
    window.dispatchEvent(new Event('pagehide'))
    expect(ipc.deleteSegment).toHaveBeenCalledWith(id)
  })
})
