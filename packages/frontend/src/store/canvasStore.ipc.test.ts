// IPCAdapter wiring — EXECUTION_PLAN.md Phase 2 "IPCAdapter calls wired".
// Separate file for the same reason as notebookStore.ipc.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setIPCAdapter, useCanvasStore } from './canvasStore'
import type { IPCAdapter, Segment as WireSegment } from '@flownote/ipc-adapter'

function mockAdapter(): IPCAdapter {
  return {
    saveSegment: vi.fn().mockResolvedValue(undefined),
    deleteSegment: vi.fn().mockResolvedValue(undefined),
    listSegments: vi.fn().mockResolvedValue([]),
  } as unknown as IPCAdapter
}

beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
})

describe('canvasStore IPCAdapter wiring', () => {
  it('persists a newly created segment via saveSegment', () => {
    const ipc = mockAdapter()
    setIPCAdapter(ipc)
    try {
      const id = useCanvasStore.getState().createSegment('page-1', 10, 20)
      expect(ipc.saveSegment).toHaveBeenCalledWith(expect.objectContaining({ id, pageId: 'page-1', x: 10, y: 20 }))
    } finally {
      setIPCAdapter(null)
    }
  })

  it('persists a deletion via deleteSegment when a coloured segment turns uncoloured-and-empty', () => {
    const ipc = mockAdapter()
    setIPCAdapter(ipc)
    try {
      const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
      useCanvasStore.getState().deleteIfEmptyAndUncolored(id)
      expect(ipc.deleteSegment).toHaveBeenCalledWith(id)
      expect(useCanvasStore.getState().segments[id]).toBeUndefined()
    } finally {
      setIPCAdapter(null)
    }
  })

  it('does not throw when no adapter is set', () => {
    setIPCAdapter(null)
    expect(() => useCanvasStore.getState().createSegment('page-1', 0, 0)).not.toThrow()
  })

  it('loadSegmentsForPage replaces that page\'s segments with persisted ones', async () => {
    const ipc = mockAdapter()
    const persisted: WireSegment = {
      id: 'seg-1',
      pageId: 'page-1',
      x: 5,
      y: 5,
      w: 320,
      h: 80,
      zIndex: 0,
      borderColor: null,
      fillColor: null,
      content: { type: 'doc', content: [] },
    }
    vi.mocked(ipc.listSegments).mockResolvedValue([persisted])
    setIPCAdapter(ipc)
    try {
      await useCanvasStore.getState().loadSegmentsForPage('page-1')
      expect(useCanvasStore.getState().segments['seg-1']).toMatchObject({ pageId: 'page-1', x: 5, y: 5 })
    } finally {
      setIPCAdapter(null)
    }
  })

  it('loadSegmentsForPage is a no-op when no adapter is set', async () => {
    setIPCAdapter(null)
    await expect(useCanvasStore.getState().loadSegmentsForPage('page-1')).resolves.toBeUndefined()
  })
})
