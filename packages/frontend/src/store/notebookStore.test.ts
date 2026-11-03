import { beforeEach, describe, expect, it } from 'vitest'
import { loadLastOpenedPage } from '../lib/lastOpenedPage'
import {
  DEFAULT_MAX_FOLDER_DEPTH,
  childFoldersOf,
  fileCountOf,
  filesInFolderOf,
  searchFilesByContent,
  searchFilesByName,
  useNotebookStore,
} from './notebookStore'

beforeEach(() => {
  useNotebookStore.setState({
    folders: {},
    files: {},
    selectedFolderId: null,
    selectedFileId: null,
    maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH,
  })
})

describe('createFolder', () => {
  it('auto-capitalizes an all-lowercase name', () => {
    const { id } = useNotebookStore.getState().createFolder(null, 'projects')
    expect(useNotebookStore.getState().folders[id!]?.name).toBe('Projects')
  })

  it('rejects an empty name', () => {
    const result = useNotebookStore.getState().createFolder(null, '   ')
    expect(result.ok).toBe(false)
  })

  it('enforces the configured max nesting depth', () => {
    const store = useNotebookStore.getState()
    useNotebookStore.setState({ maxFolderDepth: 2 })

    const top = store.createFolder(null, 'Top')
    const mid = store.createFolder(top.id!, 'Mid')
    const deep = store.createFolder(mid.id!, 'Deep')

    expect(mid.ok).toBe(true)
    expect(deep.ok).toBe(false)
  })
})

describe('setFolderIcon', () => {
  it('sets a folder icon', () => {
    const { id } = useNotebookStore.getState().createFolder(null, 'Projects')
    useNotebookStore.getState().setFolderIcon(id!, '⭐')
    expect(useNotebookStore.getState().folders[id!]?.icon).toBe('⭐')
  })

  it('clears back to the default with null', () => {
    const { id } = useNotebookStore.getState().createFolder(null, 'Projects')
    useNotebookStore.getState().setFolderIcon(id!, '⭐')
    useNotebookStore.getState().setFolderIcon(id!, null)
    expect(useNotebookStore.getState().folders[id!]?.icon).toBeNull()
  })

  it('is a no-op for a missing folder id', () => {
    expect(() => useNotebookStore.getState().setFolderIcon('missing', '⭐')).not.toThrow()
  })
})

describe('childFoldersOf', () => {
  it('returns only direct children, in natural order', () => {
    const store = useNotebookStore.getState()
    const root = store.createFolder(null, 'Root')
    store.createFolder(root.id!, 'Folder 10')
    store.createFolder(root.id!, 'Folder 2')
    store.createFolder(null, 'Sibling of Root')

    const children = childFoldersOf(useNotebookStore.getState().folders, root.id!)
    expect(children.map((f) => f.name)).toEqual(['Folder 2', 'Folder 10'])
  })
})

describe('fileCountOf', () => {
  it('counts only files directly in that folder', () => {
    const store = useNotebookStore.getState()
    const a = store.createFolder(null, 'A')
    const b = store.createFolder(null, 'B')
    store.createFile(a.id!, 'One')
    store.createFile(a.id!, 'Two')
    store.createFile(b.id!, 'Three')

    const files = useNotebookStore.getState().files
    expect(fileCountOf(files, a.id!)).toBe(2)
    expect(fileCountOf(files, b.id!)).toBe(1)
  })
})

describe('createFile', () => {
  it('rejects a name that does not start with a capital letter', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    const result = store.createFile(folder.id!, 'untitled')
    expect(result.ok).toBe(false)
  })

  it('enforces uniqueness within a folder but allows the same name in a different folder', () => {
    const store = useNotebookStore.getState()
    const a = store.createFolder(null, 'A')
    const b = store.createFolder(null, 'B')

    expect(store.createFile(a.id!, 'Todo').ok).toBe(true)
    expect(store.createFile(a.id!, 'Todo').ok).toBe(false)
    expect(store.createFile(b.id!, 'Todo').ok).toBe(true)
  })

  it('lists files in natural order', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    store.createFile(folder.id!, 'Page 10')
    store.createFile(folder.id!, 'Page 2')

    const files = filesInFolderOf(useNotebookStore.getState().files, folder.id!)
    expect(files.map((f) => f.name)).toEqual(['Page 2', 'Page 10'])
  })
})

describe('renameFile', () => {
  it('renames the file and re-validates the name', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    const file = store.createFile(folder.id!, 'Todo')

    const result = store.renameFile(file.id!, 'Roadmap')
    expect(result.ok).toBe(true)
    expect(useNotebookStore.getState().files[file.id!]?.name).toBe('Roadmap')
  })

  it('rejects a name that does not start with a capital letter, leaving the old name in place', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    const file = store.createFile(folder.id!, 'Todo')

    const result = store.renameFile(file.id!, 'todo')
    expect(result.ok).toBe(false)
    expect(useNotebookStore.getState().files[file.id!]?.name).toBe('Todo')
  })

  it('rejects a duplicate name within the same folder but allows renaming to itself', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    const a = store.createFile(folder.id!, 'Todo')
    store.createFile(folder.id!, 'Roadmap')

    expect(store.renameFile(a.id!, 'Roadmap').ok).toBe(false)
    expect(store.renameFile(a.id!, 'Todo').ok).toBe(true)
  })

  it('allows the same name reused in a different folder', () => {
    const store = useNotebookStore.getState()
    const a = store.createFolder(null, 'A')
    const b = store.createFolder(null, 'B')
    store.createFile(a.id!, 'Todo')
    const fileInB = store.createFile(b.id!, 'Other')

    expect(store.renameFile(fileInB.id!, 'Todo').ok).toBe(true)
  })
})

describe('search', () => {
  it('searchFilesByName matches on file name only', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    store.createFile(folder.id!, 'Roadmap', 'nothing relevant here')
    store.createFile(folder.id!, 'Budget', 'roadmap mentioned in passing')

    const results = searchFilesByName(useNotebookStore.getState().files, 'roadmap')
    expect(results.map((f) => f.name)).toEqual(['Roadmap'])
  })

  it('searchFilesByContent matches on file content only', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    store.createFile(folder.id!, 'Roadmap', 'nothing relevant here')
    store.createFile(folder.id!, 'Budget', 'roadmap mentioned in passing')

    const results = searchFilesByContent(useNotebookStore.getState().files, 'roadmap')
    expect(results.map((f) => f.name)).toEqual(['Budget'])
  })

  it('returns nothing for an empty query', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    store.createFile(folder.id!, 'Roadmap')

    expect(searchFilesByName(useNotebookStore.getState().files, '')).toEqual([])
  })
})

describe('setFileMode (DESIGN.md §4.3 mode toggle)', () => {
  it('defaults new files to canvas mode', () => {
    const { id } = useNotebookStore.getState().createFile('folder-1', 'Todo')
    expect(useNotebookStore.getState().files[id!]?.mode).toBe('canvas')
  })

  it('switches to linear and back without touching any other field', () => {
    const { id } = useNotebookStore.getState().createFile('folder-1', 'Todo')
    const before = useNotebookStore.getState().files[id!]!

    useNotebookStore.getState().setFileMode(id!, 'linear')
    expect(useNotebookStore.getState().files[id!]?.mode).toBe('linear')

    useNotebookStore.getState().setFileMode(id!, 'canvas')
    const after = useNotebookStore.getState().files[id!]!
    expect(after.mode).toBe('canvas')
    expect(after.name).toBe(before.name)
    expect(after.folderId).toBe(before.folderId)
  })

  it('is a no-op for an unknown file id', () => {
    expect(() => useNotebookStore.getState().setFileMode('missing', 'linear')).not.toThrow()
  })
})

describe('makeId cross-session uniqueness', () => {
  // Regression test, same bug/fix as canvasStore.test.ts's
  // "makeSegmentId cross-session uniqueness": a bare per-module-load
  // counter for folder/file ids meant a freshly created page in a new app
  // launch could collide with an old persisted page id — and since
  // CanvasRoot.loadSegmentsForPage loads by page id, the new page would
  // silently inherit the old page's segments. Found live via `run-electron`.
  it('folder and file ids are not bare numeric counters', () => {
    const { id: folderId } = useNotebookStore.getState().createFolder(null, 'Notes')
    const { id: fileId } = useNotebookStore.getState().createFile(folderId!, 'Todo')
    expect(folderId).not.toMatch(/^folder-\d+$/)
    expect(fileId).not.toMatch(/^file-\d+$/)
  })
})

describe('deleteFile', () => {
  it('removes the file and clears selection if it was selected', () => {
    const store = useNotebookStore.getState()
    const { id: folderId } = store.createFolder(null, 'Notes')
    const { id: fileId } = store.createFile(folderId!, 'Todo')
    store.selectFile(fileId!)

    store.deleteFile(fileId!)

    expect(useNotebookStore.getState().files[fileId!]).toBeUndefined()
    expect(useNotebookStore.getState().selectedFileId).toBeNull()
  })

  it('is a no-op for an unknown id', () => {
    expect(() => useNotebookStore.getState().deleteFile('missing')).not.toThrow()
  })
})

describe('deleteFolder', () => {
  it('removes the folder, its files, and nested subfolders/files', () => {
    const store = useNotebookStore.getState()
    const { id: parentId } = store.createFolder(null, 'Parent')
    const { id: childId } = store.createFolder(parentId!, 'Child')
    const { id: fileInParent } = store.createFile(parentId!, 'A')
    const { id: fileInChild } = store.createFile(childId!, 'B')
    store.selectFolder(childId!)
    store.selectFile(fileInChild!)

    store.deleteFolder(parentId!)

    const state = useNotebookStore.getState()
    expect(state.folders[parentId!]).toBeUndefined()
    expect(state.folders[childId!]).toBeUndefined()
    expect(state.files[fileInParent!]).toBeUndefined()
    expect(state.files[fileInChild!]).toBeUndefined()
    expect(state.selectedFolderId).toBeNull()
    expect(state.selectedFileId).toBeNull()
  })

  it('leaves unrelated folders/files and selection untouched', () => {
    const store = useNotebookStore.getState()
    const { id: targetId } = store.createFolder(null, 'Target')
    const { id: keepId } = store.createFolder(null, 'Keep')
    const { id: keepFileId } = store.createFile(keepId!, 'Keeper')
    store.selectFolder(keepId!)
    store.selectFile(keepFileId!)

    store.deleteFolder(targetId!)

    const state = useNotebookStore.getState()
    expect(state.folders[keepId!]).toBeDefined()
    expect(state.files[keepFileId!]).toBeDefined()
    expect(state.selectedFolderId).toBe(keepId)
    expect(state.selectedFileId).toBe(keepFileId)
  })

  it('is a no-op for an unknown id', () => {
    expect(() => useNotebookStore.getState().deleteFolder('missing')).not.toThrow()
  })
})

describe('moveFolder (drag-and-drop reparent)', () => {
  it('moves a folder under a new parent', () => {
    const store = useNotebookStore.getState()
    const { id: a } = store.createFolder(null, 'A')
    const { id: b } = store.createFolder(null, 'B')

    const result = store.moveFolder(a!, b!)

    expect(result.ok).toBe(true)
    expect(useNotebookStore.getState().folders[a!]?.parentId).toBe(b)
  })

  it('moves a folder to the root when newParentId is null', () => {
    const store = useNotebookStore.getState()
    const { id: parent } = store.createFolder(null, 'Parent')
    const { id: child } = store.createFolder(parent!, 'Child')

    const result = store.moveFolder(child!, null)

    expect(result.ok).toBe(true)
    expect(useNotebookStore.getState().folders[child!]?.parentId).toBeNull()
  })

  it('rejects moving a folder into itself', () => {
    const store = useNotebookStore.getState()
    const { id } = store.createFolder(null, 'A')
    const result = store.moveFolder(id!, id!)
    expect(result.ok).toBe(false)
  })

  it('rejects moving a folder into one of its own subfolders', () => {
    const store = useNotebookStore.getState()
    const { id: parent } = store.createFolder(null, 'Parent')
    const { id: child } = store.createFolder(parent!, 'Child')

    const result = store.moveFolder(parent!, child!)

    expect(result.ok).toBe(false)
    expect(useNotebookStore.getState().folders[parent!]?.parentId).toBeNull()
  })

  it('enforces the configured max nesting depth', () => {
    const store = useNotebookStore.getState()
    useNotebookStore.setState({ maxFolderDepth: 2 })
    const { id: top } = store.createFolder(null, 'Top')
    const { id: mid } = store.createFolder(null, 'Mid')
    const { id: other } = store.createFolder(null, 'Other')

    // Nest `mid` under `top` first so it's at depth 1, then trying to move
    // `other` under `mid` would put it at depth 2 — past the depth-2 limit.
    store.moveFolder(mid!, top!)
    const result = store.moveFolder(other!, mid!)

    expect(result.ok).toBe(false)
  })

  it('is a no-op for an unknown id', () => {
    const result = useNotebookStore.getState().moveFolder('missing', null)
    expect(result.ok).toBe(false)
  })
})

describe('moveFile (drag-and-drop move)', () => {
  it('moves a file into another folder', () => {
    const store = useNotebookStore.getState()
    const { id: folderA } = store.createFolder(null, 'A')
    const { id: folderB } = store.createFolder(null, 'B')
    const { id: fileId } = store.createFile(folderA!, 'Notes')

    const result = store.moveFile(fileId!, folderB!)

    expect(result.ok).toBe(true)
    expect(useNotebookStore.getState().files[fileId!]?.folderId).toBe(folderB)
  })

  it('rejects moving into a folder that already has a same-named file', () => {
    const store = useNotebookStore.getState()
    const { id: folderA } = store.createFolder(null, 'A')
    const { id: folderB } = store.createFolder(null, 'B')
    store.createFile(folderB!, 'Notes')
    const { id: fileId } = store.createFile(folderA!, 'Notes')

    const result = store.moveFile(fileId!, folderB!)

    expect(result.ok).toBe(false)
    expect(useNotebookStore.getState().files[fileId!]?.folderId).toBe(folderA)
  })

  it('rejects an unknown target folder', () => {
    const store = useNotebookStore.getState()
    const { id: folderA } = store.createFolder(null, 'A')
    const { id: fileId } = store.createFile(folderA!, 'Notes')

    const result = store.moveFile(fileId!, 'missing-folder')

    expect(result.ok).toBe(false)
  })

  it('is a no-op for an unknown file id', () => {
    const store = useNotebookStore.getState()
    const { id: folderA } = store.createFolder(null, 'A')
    const result = store.moveFile('missing', folderA!)
    expect(result.ok).toBe(false)
  })
})

describe('selectFile remembers the last opened page', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists the folder and file id when opening a real file', () => {
    const store = useNotebookStore.getState()
    const { id: folderId } = store.createFolder(null, 'Notes')
    const { id: fileId } = store.createFile(folderId!, 'Todo')

    store.selectFile(fileId!)

    expect(loadLastOpenedPage()).toEqual({ folderId, fileId })
  })

  it('does not touch the persisted page when deselecting (selectFile(null))', () => {
    const store = useNotebookStore.getState()
    const { id: folderId } = store.createFolder(null, 'Notes')
    const { id: fileId } = store.createFile(folderId!, 'Todo')
    store.selectFile(fileId!)

    store.selectFile(null)

    expect(loadLastOpenedPage()).toEqual({ folderId, fileId })
    expect(useNotebookStore.getState().selectedFileId).toBeNull()
  })

  it('does not persist for an unknown file id', () => {
    useNotebookStore.getState().selectFile('missing')
    expect(loadLastOpenedPage()).toBeNull()
  })
})
