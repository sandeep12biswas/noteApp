// Folder/file domain state — DESIGN.md §2.1/§2.2. This is client-side state
// only for now; wiring these actions through IPCAdapter to real SQLite
// storage is a separate later task ("IPCAdapter calls wired" in
// EXECUTION_PLAN.md's Phase 2 table) — the shapes here are deliberately
// close to the `pages`/eventual `folders` tables (DESIGN.md §7.2) so that
// swap is mostly replacing these reducers' bodies with `ipc.*` calls.
import { create } from 'zustand'
import { capitalizeFirstLetter, validateFileName } from '../lib/validation'
import { naturalSortBy } from '../lib/naturalSort'

/** DESIGN.md §2.1: folder hierarchy depth is configurable, defaulting to 7. */
export const DEFAULT_MAX_FOLDER_DEPTH = 7

export interface Folder {
  id: string
  name: string
  parentId: string | null
  icon: string | null
  expanded: boolean
}

export interface FileEntry {
  id: string
  name: string
  folderId: string
  content: string
  updatedAt: number
}

type Folders = Record<string, Folder>
type Files = Record<string, FileEntry>

// Derived-data helpers, deliberately plain functions rather than store
// methods: a Zustand selector that calls one of these must be wrapped in
// `useMemo` (keyed on the raw `folders`/`files` map) by the caller, since
// each of these allocates a new array — calling them directly as
// `useStore(s => s.childFolders(id))` would hand useSyncExternalStore a new
// reference every render and infinite-loop.

export function folderDepthOf(folders: Folders, id: string): number {
  let depth = 0
  let current = folders[id]
  while (current?.parentId) {
    depth++
    current = folders[current.parentId]
  }
  return depth
}

export function childFoldersOf(folders: Folders, parentId: string | null): Folder[] {
  return naturalSortBy(
    Object.values(folders).filter((f) => f.parentId === parentId),
    (f) => f.name,
  )
}

export function fileCountOf(files: Files, folderId: string): number {
  return Object.values(files).filter((f) => f.folderId === folderId).length
}

export function filesInFolderOf(files: Files, folderId: string): FileEntry[] {
  return naturalSortBy(
    Object.values(files).filter((f) => f.folderId === folderId),
    (f) => f.name,
  )
}

function searchFiles(files: Files, query: string, matches: (f: FileEntry, q: string) => boolean): FileEntry[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []
  return naturalSortBy(
    Object.values(files).filter((f) => matches(f, q)),
    (f) => f.name,
  )
}

export function searchFilesByName(files: Files, query: string): FileEntry[] {
  return searchFiles(files, query, (f, q) => f.name.toLowerCase().includes(q))
}

export function searchFilesByContent(files: Files, query: string): FileEntry[] {
  return searchFiles(files, query, (f, q) => f.content.toLowerCase().includes(q))
}

interface MutationResult {
  ok: boolean
  error?: string
  id?: string
}

interface NotebookState {
  folders: Folders
  files: Files
  selectedFolderId: string | null
  selectedFileId: string | null
  maxFolderDepth: number

  createFolder: (parentId: string | null, rawName: string) => MutationResult
  renameFolder: (id: string, rawName: string) => void
  toggleFolderExpanded: (id: string) => void
  setFolderIcon: (id: string, icon: string) => void
  selectFolder: (id: string | null) => void

  createFile: (folderId: string, rawName: string, content?: string) => MutationResult
  selectFile: (id: string | null) => void
}

let nextId = 1
function makeId(prefix: string): string {
  return `${prefix}-${nextId++}`
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  folders: {},
  files: {},
  selectedFolderId: null,
  selectedFileId: null,
  maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH,

  createFolder: (parentId, rawName) => {
    const name = capitalizeFirstLetter(rawName.trim())
    if (name.length === 0) return { ok: false, error: 'Folder name cannot be empty.' }

    const parentDepth = parentId ? folderDepthOf(get().folders, parentId) : -1
    if (parentDepth + 1 >= get().maxFolderDepth) {
      return { ok: false, error: `Folders can be nested at most ${get().maxFolderDepth} levels deep.` }
    }

    const id = makeId('folder')
    set((state) => ({
      folders: { ...state.folders, [id]: { id, name, parentId, icon: null, expanded: false } },
    }))
    return { ok: true, id }
  },

  renameFolder: (id, rawName) => {
    const name = capitalizeFirstLetter(rawName)
    set((state) => {
      const folder = state.folders[id]
      if (!folder) return state
      return { folders: { ...state.folders, [id]: { ...folder, name } } }
    })
  },

  toggleFolderExpanded: (id) =>
    set((state) => {
      const folder = state.folders[id]
      if (!folder) return state
      return { folders: { ...state.folders, [id]: { ...folder, expanded: !folder.expanded } } }
    }),

  setFolderIcon: (id, icon) =>
    set((state) => {
      const folder = state.folders[id]
      if (!folder) return state
      return { folders: { ...state.folders, [id]: { ...folder, icon } } }
    }),

  selectFolder: (id) => set({ selectedFolderId: id }),

  createFile: (folderId, rawName, content = '') => {
    const name = rawName.trim()
    const validation = validateFileName(name)
    if (!validation.valid) return { ok: false, error: validation.error }

    // Per-folder uniqueness (DESIGN.md §2.2) — the same name may exist in
    // different folders, so only check within this one.
    const duplicate = Object.values(get().files).some((f) => f.folderId === folderId && f.name === name)
    if (duplicate) return { ok: false, error: `"${name}" already exists in this folder.` }

    const id = makeId('file')
    set((state) => ({
      files: { ...state.files, [id]: { id, name, folderId, content, updatedAt: Date.now() } },
    }))
    return { ok: true, id }
  },

  selectFile: (id) => set({ selectedFileId: id }),
}))
