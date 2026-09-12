import { createTRPCProxyClient } from '@trpc/client'
import { ipcLink } from 'electron-trpc/renderer'
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

// The renderer-side trpc client's procedure shape, hand-mirrored from
// apps/electron/src/trpc/router.ts's `AppRouter` rather than imported from
// it — apps/electron depends on this package, not the other way around, and
// pulling its type across that boundary would need a shared third package.
// electron-trpc's `ipcLink` is structural at runtime (DESIGN.md §10
// "IPCAdapter type drift" is exactly this risk); keep this type in sync by
// hand when router.ts's procedures change, the same discipline
// contract.test.ts and tauri.test.ts already apply to the Tauri side.
interface ElectronRouter {
  ping: { query: () => Promise<string> }
  getPage: { query: (pageId: string) => Promise<Page> }
  saveFolder: { mutate: (folder: Folder) => Promise<void> }
  listFolders: { query: () => Promise<Folder[]> }
  savePage: { mutate: (page: { id: string; folderId: string; title: string }) => Promise<void> }
  listPages: { query: (folderId: string) => Promise<Page[]> }
  deletePage: { mutate: (id: string) => Promise<void> }
  deleteFolder: { mutate: (id: string) => Promise<void> }
  listSegments: { query: (pageId: string) => Promise<Segment[]> }
  saveSegment: { mutate: (seg: Segment) => Promise<void> }
  saveSegmentsBatch: { mutate: (segs: Segment[]) => Promise<void> }
  deleteSegment: { mutate: (id: string) => Promise<void> }
  saveInkLayer: { mutate: (input: { pageId: string; dataUrl: string }) => Promise<void> }
  getInkLayer: { query: (pageId: string) => Promise<string | null> }
  addDictionaryWord: { mutate: (word: string) => Promise<void> }
  listDictionaryWords: { query: () => Promise<string[]> }
  setPageMode: { mutate: (input: { pageId: string; mode: 'canvas' | 'linear' }) => Promise<void> }
  search: { query: (input: { query: string; notebookId: string }) => Promise<SearchResult[]> }
  installPlugin: { mutate: (source: string) => Promise<PluginManifest> }
  uninstallPlugin: { mutate: (id: string) => Promise<void> }
  setPluginEnabled: { mutate: (input: { id: string; enabled: boolean }) => Promise<void> }
  getInstalledPlugins: { query: () => Promise<PluginManifest[]> }
  pluginStorageGet: { query: (input: { pluginId: string; key: string }) => Promise<string | null> }
  pluginStorageSet: { mutate: (input: { pluginId: string; key: string; value: string }) => Promise<void> }
  pluginStorageDelete: { mutate: (input: { pluginId: string; key: string }) => Promise<void> }
  pluginStorageList: { query: (pluginId: string) => Promise<string[]> }
}

let client: ElectronRouter | null = null
function getClient(): ElectronRouter {
  // `createTRPCProxyClient` has no way to know `ElectronRouter`'s procedures
  // are real trpc router procedures (it isn't a genuine `AnyRouter` — see
  // the module doc above), so its generic is `any` here and the cast below
  // is what actually gives call sites their types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client ??= createTRPCProxyClient<any>({ links: [ipcLink()] }) as unknown as ElectronRouter
  return client
}

// Backed by electron-trpc, exposed on window.electronTRPC by the Electron
// preload script (apps/electron/src/preload.ts). Every method below is a
// thin pass-through matching apps/electron/src/trpc/router.ts's procedure
// names one-for-one — see that file's module doc for how to add a new one.
export class ElectronIPCAdapter implements IPCAdapter {
  async getPage(pageId: string): Promise<Page> {
    return getClient().getPage.query(pageId)
  }

  async saveFolder(folder: Folder): Promise<void> {
    await getClient().saveFolder.mutate(folder)
  }

  async listFolders(): Promise<Folder[]> {
    return getClient().listFolders.query()
  }

  async savePage(page: { id: string; folderId: string; title: string }): Promise<void> {
    await getClient().savePage.mutate(page)
  }

  async listPages(folderId: string): Promise<Page[]> {
    return getClient().listPages.query(folderId)
  }

  async deletePage(id: string): Promise<void> {
    await getClient().deletePage.mutate(id)
  }

  async deleteFolder(id: string): Promise<void> {
    await getClient().deleteFolder.mutate(id)
  }

  async listSegments(pageId: string): Promise<Segment[]> {
    return getClient().listSegments.query(pageId)
  }

  async saveSegment(seg: Segment): Promise<void> {
    await getClient().saveSegment.mutate(seg)
  }

  async saveSegmentsBatch(segs: Segment[]): Promise<void> {
    await getClient().saveSegmentsBatch.mutate(segs)
  }

  async deleteSegment(id: string): Promise<void> {
    await getClient().deleteSegment.mutate(id)
  }

  async saveBlock(_block: Block): Promise<void> {
    throw new Error('ElectronIPCAdapter.saveBlock not implemented')
  }

  async saveInkLayer(pageId: string, dataUrl: string): Promise<void> {
    await getClient().saveInkLayer.mutate({ pageId, dataUrl })
  }

  async getInkLayer(pageId: string): Promise<string | null> {
    return getClient().getInkLayer.query(pageId)
  }

  async addDictionaryWord(word: string): Promise<void> {
    await getClient().addDictionaryWord.mutate(word)
  }

  async listDictionaryWords(): Promise<string[]> {
    return getClient().listDictionaryWords.query()
  }

  async mergeSegments(_idA: string, _idB: string): Promise<void> {
    throw new Error('ElectronIPCAdapter.mergeSegments not implemented')
  }

  async search(query: string, notebookId: string): Promise<SearchResult[]> {
    return getClient().search.query({ query, notebookId })
  }

  async setPageMode(pageId: string, mode: 'canvas' | 'linear'): Promise<void> {
    await getClient().setPageMode.mutate({ pageId, mode })
  }

  onSyncEvent(_handler: (event: SyncEvent) => void): () => void {
    throw new Error('ElectronIPCAdapter.onSyncEvent not implemented')
  }

  // eslint-disable-next-line require-yield -- stub throws before ever yielding
  async *aiComplete(_prompt: string, _context: string): AsyncIterableIterator<string> {
    throw new Error('ElectronIPCAdapter.aiComplete not implemented')
  }

  async installPlugin(source: string): Promise<PluginManifest> {
    return getClient().installPlugin.mutate(source)
  }

  async uninstallPlugin(id: string): Promise<void> {
    await getClient().uninstallPlugin.mutate(id)
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    await getClient().setPluginEnabled.mutate({ id, enabled })
  }

  async getInstalledPlugins(): Promise<PluginManifest[]> {
    return getClient().getInstalledPlugins.query()
  }

  async pluginStorageGet(pluginId: string, key: string): Promise<string | null> {
    return getClient().pluginStorageGet.query({ pluginId, key })
  }

  async pluginStorageSet(pluginId: string, key: string, value: string): Promise<void> {
    await getClient().pluginStorageSet.mutate({ pluginId, key, value })
  }

  async pluginStorageDelete(pluginId: string, key: string): Promise<void> {
    await getClient().pluginStorageDelete.mutate({ pluginId, key })
  }

  async pluginStorageList(pluginId: string): Promise<string[]> {
    return getClient().pluginStorageList.query(pluginId)
  }
}
