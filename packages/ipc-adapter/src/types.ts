// IPCAdapter — the one and only backend-call surface for the frontend.
// packages/frontend must never call invoke() or ipcRenderer directly (DESIGN.md §3.3).
// Fill in Page / Segment / Block / SearchResult / SyncEvent / PluginManifest with the
// shared types once they're defined (likely generated via tauri-specta for the Tauri
// side, mirrored by hand or via electron-trpc types for the Electron side).

// Matches the `pages` table (DESIGN.md §7.2) and generated/tauri-bindings.ts's
// `PageDto` — both flownote-electron's protocol.rs and flownote-tauri's
// commands.rs return exactly this shape for getPage (DESIGN.md §10 "IPCAdapter
// type drift"). Timestamps are epoch milliseconds.
export interface Page {
  id: string
  notebookId: string
  title: string
  mode: 'canvas' | 'linear'
  createdAt: number
  updatedAt: number
}

// `folderId` isn't on the shared `PageDto`/`get_page` response yet (DESIGN.md
// §10 "IPCAdapter type drift" — keep Page's on-the-wire shape stable),
// hence the separate input type `savePage`/`listPages` use.

// Matches packages/frontend/src/store/canvasStore.ts's `Segment` (minus
// `createdAt`/`updatedAt`, which the backend owns) and both
// flownote-electron's protocol.rs / flownote-tauri's commands.rs
// `save_segment`/`SegmentInput` — DESIGN.md §4.1/§7.1. `content` is the
// TipTap JSON document, passed through as an opaque value; see the V2
// migration's notes on why it isn't decomposed into `blocks` rows yet.
export interface Segment {
  id: string
  pageId: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  borderColor: string | null
  fillColor: string | null
  content: Record<string, unknown>
}

// Matches notebookStore.ts's `Folder` — DESIGN.md §2.1.
export interface Folder {
  id: string
  name: string
  parentId: string | null
  icon: string | null
  expanded: boolean
}

export interface Block {
  id: string
  segmentId: string
  // TODO
}

export interface SearchResult {
  pageId: string
  segmentId: string
  snippet: string
}

export interface SyncEvent {
  // TODO: Automerge-derived change event shape
  type: string
  payload: unknown
}

// Matches `flownote-plugin.json` (DESIGN.md §9.3) plus the two columns
// `plugins` (Rust) tracks itself (`enabled`, `installedAt`) — both
// `install_plugin` and `get_installed_plugins` return this full shape so
// `PluginManager` never needs a second round-trip to read a plugin's
// declared permissions/extensionPoints/entry before creating its iframe.
export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  entry: string
  sdkVersion: string
  permissions: string[]
  extensionPoints: string[]
  minAppVersion: string
  enabled: boolean
  installedAt: number
}

export interface IPCAdapter {
  getPage(pageId: string): Promise<Page>
  saveFolder(folder: Folder): Promise<void>
  listFolders(): Promise<Folder[]>
  savePage(page: { id: string; folderId: string; title: string }): Promise<void>
  listPages(folderId: string): Promise<Page[]>
  listSegments(pageId: string): Promise<Segment[]>
  saveSegment(seg: Segment): Promise<void>
  saveSegmentsBatch(segs: Segment[]): Promise<void>
  deleteSegment(id: string): Promise<void>
  saveBlock(block: Block): Promise<void>
  saveInkLayer(pageId: string, dataUrl: string): Promise<void>
  getInkLayer(pageId: string): Promise<string | null>
  addDictionaryWord(word: string): Promise<void>
  listDictionaryWords(): Promise<string[]>
  mergeSegments(idA: string, idB: string): Promise<void>
  search(query: string, notebookId: string): Promise<SearchResult[]>
  setPageMode(pageId: string, mode: 'canvas' | 'linear'): Promise<void>
  onSyncEvent(handler: (event: SyncEvent) => void): () => void
  aiComplete(prompt: string, context: string): AsyncIterableIterator<string>
  // Plugin-related IPC (added in v1.4)
  installPlugin(source: string): Promise<PluginManifest>
  uninstallPlugin(id: string): Promise<void>
  setPluginEnabled(id: string, enabled: boolean): Promise<void>
  getInstalledPlugins(): Promise<PluginManifest[]>
  pluginStorageGet(pluginId: string, key: string): Promise<string | null>
  pluginStorageSet(pluginId: string, key: string, value: string): Promise<void>
  pluginStorageDelete(pluginId: string, key: string): Promise<void>
  pluginStorageList(pluginId: string): Promise<string[]>
}
