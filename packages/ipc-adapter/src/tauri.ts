import { commands } from './generated/tauri-bindings'
import type {
  Block,
  IPCAdapter,
  Page,
  PluginManifest,
  SearchResult,
  Segment,
  SyncEvent,
} from './types'

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

  async saveSegment(_seg: Segment): Promise<void> {
    throw new Error('TauriIPCAdapter.saveSegment not implemented')
  }

  async saveSegmentsBatch(_segs: Segment[]): Promise<void> {
    throw new Error('TauriIPCAdapter.saveSegmentsBatch not implemented')
  }

  async deleteSegment(_id: string): Promise<void> {
    throw new Error('TauriIPCAdapter.deleteSegment not implemented')
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
}
