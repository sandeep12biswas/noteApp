// IPCAdapter wiring — EXECUTION_PLAN.md Phase 2 "IPCAdapter calls wired".
// Separate from notebookStore.test.ts (which deliberately runs with no
// adapter set, i.e. `ipc === null`) so that suite's assertions about pure
// local-state behavior can't be muddied by a mock's async resolution.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_FOLDER_DEPTH, setIPCAdapter, useNotebookStore } from './notebookStore'
import type { IPCAdapter } from '@flownote/ipc-adapter'

function mockAdapter(): IPCAdapter {
  return {
    saveFolder: vi.fn().mockResolvedValue(undefined),
    listFolders: vi.fn().mockResolvedValue([]),
    savePage: vi.fn().mockResolvedValue(undefined),
    listPages: vi.fn().mockResolvedValue([]),
  } as unknown as IPCAdapter
}

beforeEach(() => {
  useNotebookStore.setState({
    folders: {},
    files: {},
    selectedFolderId: null,
    selectedFileId: null,
    maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH,
  })
})

describe('notebookStore IPCAdapter wiring', () => {
  it('persists a new folder via saveFolder', () => {
    const ipc = mockAdapter()
    setIPCAdapter(ipc)
    try {
      const { id } = useNotebookStore.getState().createFolder(null, 'Work')
      expect(ipc.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ id, name: 'Work' }))
    } finally {
      setIPCAdapter(null)
    }
  })

  it('persists a new file via savePage', () => {
    const ipc = mockAdapter()
    setIPCAdapter(ipc)
    try {
      const { id: folderId } = useNotebookStore.getState().createFolder(null, 'Work')
      const { id } = useNotebookStore.getState().createFile(folderId!, 'Notes.md')
      expect(ipc.savePage).toHaveBeenCalledWith({ id, folderId, title: 'Notes.md' })
    } finally {
      setIPCAdapter(null)
    }
  })

  it('persists a folder icon change via saveFolder', () => {
    const ipc = mockAdapter()
    setIPCAdapter(ipc)
    try {
      const { id } = useNotebookStore.getState().createFolder(null, 'Work')
      useNotebookStore.getState().setFolderIcon(id!, '⭐')
      expect(ipc.saveFolder).toHaveBeenLastCalledWith(expect.objectContaining({ id, icon: '⭐' }))
    } finally {
      setIPCAdapter(null)
    }
  })

  it('does not throw when no adapter is set', () => {
    setIPCAdapter(null)
    expect(() => useNotebookStore.getState().createFolder(null, 'Work')).not.toThrow()
  })

  it('hydrateFromIPC loads folders and their pages into state', async () => {
    const ipc = mockAdapter()
    vi.mocked(ipc.listFolders).mockResolvedValue([
      { id: 'folder-1', name: 'Work', parentId: null, icon: null, expanded: false },
    ])
    vi.mocked(ipc.listPages).mockResolvedValue([
      { id: 'page-1', notebookId: 'nb-1', title: 'Notes', mode: 'canvas', createdAt: 0, updatedAt: 5 },
    ])
    setIPCAdapter(ipc)
    try {
      await useNotebookStore.getState().hydrateFromIPC()
      const state = useNotebookStore.getState()
      expect(state.folders['folder-1']?.name).toBe('Work')
      expect(state.files['page-1']?.name).toBe('Notes')
      expect(state.files['page-1']?.folderId).toBe('folder-1')
    } finally {
      setIPCAdapter(null)
    }
  })

  it('hydrateFromIPC is a no-op when no adapter is set', async () => {
    setIPCAdapter(null)
    await expect(useNotebookStore.getState().hydrateFromIPC()).resolves.toBeUndefined()
  })
})
