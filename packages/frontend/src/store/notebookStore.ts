// Folder/file domain state — DESIGN.md §2.1/§2.2. Reducers stay synchronous
// and remain the source of truth for local state (so existing callers and
// tests are untouched); each mutation additionally fires an IPCAdapter call
// to persist it to real SQLite storage ("IPCAdapter calls wired",
// EXECUTION_PLAN.md Phase 2) — fire-and-forget, since nothing here is on the
// critical path for the UI to stay responsive. `setIPCAdapter` is a no-op
// until `App.tsx` resolves a real adapter at startup, which is also what
// keeps this store's ~30 existing unit tests adapter-free.
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { create } from 'zustand'
import { capitalizeFirstLetter, validateFileName } from '../lib/validation'
import { naturalSortBy } from '../lib/naturalSort'

let ipc: IPCAdapter | null = null

/** Called once at startup (App.tsx) once `resolveIPCAdapter()` settles. */
export function setIPCAdapter(adapter: IPCAdapter | null): void {
  ipc = adapter
}

function persist(label: string, promise: Promise<unknown> | undefined): void {
  promise?.catch((err: unknown) => {
    // eslint-disable-next-line no-console -- best-effort persistence; nothing else observes this failure yet
    console.error(`notebookStore: ${label} failed`, err)
  })
}

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
  /** Editor pane title rename (DESIGN.md §5.2) — same validation/uniqueness rules as create. */
  renameFile: (id: string, rawName: string) => MutationResult
  selectFile: (id: string | null) => void
  /** Mirrors CanvasRoot segment text into the file record so content search stays live (DESIGN.md §2.2). */
  updateFileContent: (id: string, content: string) => void
  /** Loads every folder and its pages from IPCAdapter — called once at startup once an adapter resolves. */
  hydrateFromIPC: () => Promise<void>
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
    const folder: Folder = { id, name, parentId, icon: null, expanded: false }
    set((state) => ({ folders: { ...state.folders, [id]: folder } }))
    persist('saveFolder', ipc?.saveFolder(folder))
    return { ok: true, id }
  },

  renameFolder: (id, rawName) => {
    const name = capitalizeFirstLetter(rawName)
    set((state) => {
      const folder = state.folders[id]
      if (!folder) return state
      const updated = { ...folder, name }
      persist('saveFolder', ipc?.saveFolder(updated))
      return { folders: { ...state.folders, [id]: updated } }
    })
  },

  toggleFolderExpanded: (id) =>
    set((state) => {
      const folder = state.folders[id]
      if (!folder) return state
      const updated = { ...folder, expanded: !folder.expanded }
      persist('saveFolder', ipc?.saveFolder(updated))
      return { folders: { ...state.folders, [id]: updated } }
    }),

  setFolderIcon: (id, icon) =>
    set((state) => {
      const folder = state.folders[id]
      if (!folder) return state
      const updated = { ...folder, icon }
      persist('saveFolder', ipc?.saveFolder(updated))
      return { folders: { ...state.folders, [id]: updated } }
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
    persist('savePage', ipc?.savePage({ id, folderId, title: name }))
    return { ok: true, id }
  },

  renameFile: (id, rawName) => {
    const file = get().files[id]
    if (!file) return { ok: false, error: 'No such page.' }

    const name = rawName.trim()
    const validation = validateFileName(name)
    if (!validation.valid) return { ok: false, error: validation.error }

    if (name === file.name) return { ok: true, id }

    const duplicate = Object.values(get().files).some((f) => f.folderId === file.folderId && f.id !== id && f.name === name)
    if (duplicate) return { ok: false, error: `"${name}" already exists in this folder.` }

    const updated = { ...file, name, updatedAt: Date.now() }
    set((state) => ({ files: { ...state.files, [id]: updated } }))
    persist('savePage', ipc?.savePage({ id, folderId: file.folderId, title: name }))
    return { ok: true, id }
  },

  selectFile: (id) => set({ selectedFileId: id }),

  updateFileContent: (id, content) =>
    set((state) => {
      const file = state.files[id]
      if (!file) return state
      return { files: { ...state.files, [id]: { ...file, content, updatedAt: Date.now() } } }
    }),

  hydrateFromIPC: async () => {
    if (!ipc) return
    const folders = await ipc.listFolders()
    const folderMap: Folders = {}
    for (const f of folders) folderMap[f.id] = f

    const fileMap: Files = {}
    for (const folder of folders) {
      const pages = await ipc.listPages(folder.id)
      for (const p of pages) {
        fileMap[p.id] = { id: p.id, name: p.title, folderId: folder.id, content: '', updatedAt: p.updatedAt }
      }
    }
    set({ folders: folderMap, files: fileMap })
  },
}))
