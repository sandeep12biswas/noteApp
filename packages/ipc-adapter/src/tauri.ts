import { commands, type SegmentInput } from './generated/tauri-bindings'
import type {
  Block,
  Folder,
  IPCAdapter,
  Page,
  PluginManifest,
  SearchResult,
  Segment,
  SyncEvent,
} from './types'

/** Unwraps a tauri-specta `Result<T, string>`, throwing the backend's error message on failure. */
function unwrap<T>(result: { status: 'ok'; data: T } | { status: 'error'; error: string }): T {
  if (result.status === 'error') throw new Error(result.error)
  return result.data
}

// Backed by tauri-specta's generated invoke() bindings (./generated/tauri-
// bindings.ts) against the #[tauri::command] handlers in crates/flownote-
// tauri. Methods the bindings don't cover yet are still throw-stubs; as
// flownote-tauri gains a command, add it to specta_builder() there and swap
// the matching method here from a stub throw to a `commands.xxx()` call —
// mirroring how apps/electron's trpc router grows (see its module doc).
export class TauriIPCAdapter implements IPCAdapter {
  async getPage(pageId: string): Promise<Page> {
    const result = await commands.getPage(pageId)
    if (result.status === 'error') throw new Error(result.error)
    // PageDto's `mode` is a plain string on the Rust side (SQLite TEXT
    // column, DESIGN.md §7.2) — specta can't express the 'canvas'|'linear'
    // union from that, so narrow it here rather than widening our own type.
    const { mode } = result.data
    if (mode !== 'canvas' && mode !== 'linear') {
      throw new Error(`getPage: unexpected page mode "${mode}"`)
    }
    return { ...result.data, mode }
  }

  async saveFolder(folder: Folder): Promise<void> {
    unwrap(await commands.saveFolder(folder))
  }

  async listFolders(): Promise<Folder[]> {
    return unwrap(await commands.listFolders())
  }

  async savePage(page: { id: string; folderId: string; title: string }): Promise<void> {
    unwrap(await commands.savePage(page))
  }

  async listPages(folderId: string): Promise<Page[]> {
    const pages = unwrap(await commands.listPages(folderId))
    return pages.map((p) => {
      const { mode } = p
      if (mode !== 'canvas' && mode !== 'linear') {
        throw new Error(`listPages: unexpected page mode "${mode}"`)
      }
      return { ...p, mode }
    })
  }

  async listSegments(pageId: string): Promise<Segment[]> {
    return unwrap(await commands.listSegments(pageId)) as unknown as Segment[]
  }

  // `Segment.content` is `Record<string, unknown>` (a TipTap JSON doc always
  // has one) but specta can only express the generated `SegmentInput.content`
  // as the broader `JsonValue` — the cast just bridges that, not a real
  // shape mismatch.
  async saveSegment(seg: Segment): Promise<void> {
    unwrap(await commands.saveSegment(seg as unknown as SegmentInput))
  }

  async saveSegmentsBatch(segs: Segment[]): Promise<void> {
    unwrap(await commands.saveSegmentsBatch(segs as unknown as SegmentInput[]))
  }

  async deleteSegment(id: string): Promise<void> {
    unwrap(await commands.deleteSegment(id))
  }

  async saveBlock(_block: Block): Promise<void> {
    throw new Error('TauriIPCAdapter.saveBlock not implemented')
  }

  async saveInkLayer(_pageId: string, _dataUrl: string): Promise<void> {
    throw new Error('TauriIPCAdapter.saveInkLayer not implemented')
  }

  async mergeSegments(_idA: string, _idB: string): Promise<void> {
    throw new Error('TauriIPCAdapter.mergeSegments not implemented')
  }

  async search(_query: string, _notebookId: string): Promise<SearchResult[]> {
    throw new Error('TauriIPCAdapter.search not implemented')
  }

  async setPageMode(_pageId: string, _mode: 'canvas' | 'linear'): Promise<void> {
    throw new Error('TauriIPCAdapter.setPageMode not implemented')
  }

  onSyncEvent(_handler: (event: SyncEvent) => void): () => void {
    throw new Error('TauriIPCAdapter.onSyncEvent not implemented')
  }

  // eslint-disable-next-line require-yield -- stub throws before ever yielding
  async *aiComplete(_prompt: string, _context: string): AsyncIterableIterator<string> {
    throw new Error('TauriIPCAdapter.aiComplete not implemented')
  }

  async installPlugin(_source: string): Promise<PluginManifest> {
    throw new Error('TauriIPCAdapter.installPlugin not implemented')
  }

  async uninstallPlugin(_id: string): Promise<void> {
    throw new Error('TauriIPCAdapter.uninstallPlugin not implemented')
  }

  async setPluginEnabled(_id: string, _enabled: boolean): Promise<void> {
    throw new Error('TauriIPCAdapter.setPluginEnabled not implemented')
  }

  async getInstalledPlugins(): Promise<PluginManifest[]> {
    throw new Error('TauriIPCAdapter.getInstalledPlugins not implemented')
  }

  async pluginStorageGet(_pluginId: string, _key: string): Promise<string | null> {
    throw new Error('TauriIPCAdapter.pluginStorageGet not implemented')
  }

  async pluginStorageSet(_pluginId: string, _key: string, _value: string): Promise<void> {
    throw new Error('TauriIPCAdapter.pluginStorageSet not implemented')
  }

  async pluginStorageDelete(_pluginId: string, _key: string): Promise<void> {
    throw new Error('TauriIPCAdapter.pluginStorageDelete not implemented')
  }

  async pluginStorageList(_pluginId: string): Promise<string[]> {
    throw new Error('TauriIPCAdapter.pluginStorageList not implemented')
  }
}
