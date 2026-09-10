import type {
  Block,
  IPCAdapter,
  Page,
  PluginManifest,
  SearchResult,
  Segment,
  SyncEvent,
} from './types'

// Backed by electron-trpc, exposed on window.electronIPC by the Electron
// preload script. Stub — wire each method to the tRPC client once
// apps/electron's preload + main-process router exist.
export class ElectronIPCAdapter implements IPCAdapter {
  async getPage(_pageId: string): Promise<Page> {
    throw new Error(`ElectronIPCAdapter.getPage not implemented (pageId=${_pageId})`)
  }

  async saveSegment(_seg: Segment): Promise<void> {
    throw new Error('ElectronIPCAdapter.saveSegment not implemented')
  }

  async saveSegmentsBatch(_segs: Segment[]): Promise<void> {
    throw new Error('ElectronIPCAdapter.saveSegmentsBatch not implemented')
  }

  async deleteSegment(_id: string): Promise<void> {
    throw new Error('ElectronIPCAdapter.deleteSegment not implemented')
  }

  async saveBlock(_block: Block): Promise<void> {
    throw new Error('ElectronIPCAdapter.saveBlock not implemented')
  }

  async saveInkLayer(_pageId: string, _dataUrl: string): Promise<void> {
    throw new Error('ElectronIPCAdapter.saveInkLayer not implemented')
  }

  async mergeSegments(_idA: string, _idB: string): Promise<void> {
    throw new Error('ElectronIPCAdapter.mergeSegments not implemented')
  }

  async search(_query: string, _notebookId: string): Promise<SearchResult[]> {
    throw new Error('ElectronIPCAdapter.search not implemented')
  }

  async setPageMode(_pageId: string, _mode: 'canvas' | 'linear'): Promise<void> {
    throw new Error('ElectronIPCAdapter.setPageMode not implemented')
  }

  onSyncEvent(_handler: (event: SyncEvent) => void): () => void {
    throw new Error('ElectronIPCAdapter.onSyncEvent not implemented')
  }

  // eslint-disable-next-line require-yield -- stub throws before ever yielding
  async *aiComplete(_prompt: string, _context: string): AsyncIterableIterator<string> {
    throw new Error('ElectronIPCAdapter.aiComplete not implemented')
  }

  async installPlugin(_source: string): Promise<PluginManifest> {
    throw new Error('ElectronIPCAdapter.installPlugin not implemented')
  }

  async uninstallPlugin(_id: string): Promise<void> {
    throw new Error('ElectronIPCAdapter.uninstallPlugin not implemented')
  }

  async setPluginEnabled(_id: string, _enabled: boolean): Promise<void> {
    throw new Error('ElectronIPCAdapter.setPluginEnabled not implemented')
  }

  async getInstalledPlugins(): Promise<PluginManifest[]> {
    throw new Error('ElectronIPCAdapter.getInstalledPlugins not implemented')
  }

  async pluginStorageGet(_pluginId: string, _key: string): Promise<string | null> {
    throw new Error('ElectronIPCAdapter.pluginStorageGet not implemented')
  }

  async pluginStorageSet(_pluginId: string, _key: string, _value: string): Promise<void> {
    throw new Error('ElectronIPCAdapter.pluginStorageSet not implemented')
  }
}
