// Sync step S5: another device's edit to a segment that's already open
// must show in its editor (whose `content` option is only read at creation)
// — in both canvas and linear mode — without being saved straight back.
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasRoot } from './CanvasRoot'
import { LinearRoot } from './LinearRoot'
import { setIPCAdapter, useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

let ipc: IPCAdapter
afterEach(() => {
  cleanup()
  setIPCAdapter(null)
})
beforeEach(() => {
  ipc = {
    saveSegment: vi.fn().mockResolvedValue(undefined),
    saveSegmentsBatch: vi.fn().mockResolvedValue(undefined),
    deleteSegment: vi.fn().mockResolvedValue(undefined),
    listSegments: vi.fn().mockResolvedValue([]),
  } as unknown as IPCAdapter
  useCanvasStore.setState({
    activeSegmentId: null,
    segments: {
      s1: { id: 's1', pageId: 'page-1', x: 0, y: 0, w: 200, h: 40, zIndex: 0, borderColor: null, fillColor: null, content: doc('before'), createdAt: 0, updatedAt: 0 },
    },
  })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas' } },
  })
})

async function receiveRemoteEdit(text: string) {
  vi.mocked(ipc.listSegments).mockResolvedValue([
    { id: 's1', pageId: 'page-1', x: 0, y: 0, w: 200, h: 40, zIndex: 0, borderColor: null, fillColor: null, content: doc(text) },
  ])
  await act(() => useCanvasStore.getState().applyRemoteSegments('page-1'))
}

describe.each([
  ['canvas', CanvasRoot],
  ['linear', LinearRoot],
])('remote edits in %s mode', (_mode, Root) => {
  it('show in the open editor and are not saved back', async () => {
    render(<Root pageId="page-1" />)
    await waitFor(() => expect(screen.getByText('before')).toBeInTheDocument())
    setIPCAdapter(ipc)
    vi.mocked(ipc.saveSegment).mockClear()

    await receiveRemoteEdit('from the other device')

    await waitFor(() => expect(screen.getByText('from the other device')).toBeInTheDocument())
    expect(screen.queryByText('before')).not.toBeInTheDocument()
    expect(ipc.saveSegment).not.toHaveBeenCalled()
  })
})
