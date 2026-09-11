import { beforeEach, describe, expect, it } from 'vitest'
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
