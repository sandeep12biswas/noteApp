// IPCAdapter — the one and only backend-call surface for the frontend.
// packages/frontend must never call invoke() or ipcRenderer directly (DESIGN.md §3.3).
// Fill in Page / Segment / Block / SearchResult / SyncEvent / PluginManifest with the
// shared types once they're defined (likely generated via tauri-specta for the Tauri
// side, mirrored by hand or via electron-trpc types for the Electron side).

export interface Page {
  id: string
  // TODO: fields per DESIGN.md storage schema
}

export interface Segment {
  id: string
  pageId: string
  // TODO: position/size/color/blocks per DESIGN.md §4.1/§4.2
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

export interface PluginManifest {
  id: string
  name: string
  version: string
  enabled: boolean
}

export interface IPCAdapter {
  getPage(pageId: string): Promise<Page>
  saveSegment(seg: Segment): Promise<void>
  saveSegmentsBatch(segs: Segment[]): Promise<void>
  deleteSegment(id: string): Promise<void>
  saveBlock(block: Block): Promise<void>
  saveInkLayer(pageId: string, dataUrl: string): Promise<void>
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
}
