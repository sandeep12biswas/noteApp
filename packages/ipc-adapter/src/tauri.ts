import { Channel } from '@tauri-apps/api/core'
import { commands, type AiStreamEvent, type JsonValue, type SegmentInput } from './generated/tauri-bindings'
import { pushIterator } from './pushIterator'
import type {
  AiProvider,
  AiProviderInput,
  Attachment,
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
// tauri, which wrap the same flownote_core::store functions the Electron
// sidecar calls. Every method ElectronIPCAdapter implements is implemented
// here too; the remaining throw-stubs (saveBlock, mergeSegments,
// onSyncEvent) are unimplemented on both platforms. To add a
// method: add the storage function to flownote_core::store, expose it from
// both shells, regenerate the bindings (`cargo run -p flownote-tauri
// --example export_bindings`), then call `commands.xxx()` here.
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

  async deletePage(id: string): Promise<void> {
    unwrap(await commands.deletePage(id))
  }

  async deleteFolder(id: string): Promise<void> {
    unwrap(await commands.deleteFolder(id))
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

  async saveAttachment(id: string, segmentId: string, fileName: string, mimeType: string, dataBase64: string): Promise<Attachment> {
    return unwrap(await commands.saveAttachment(id, segmentId, fileName, mimeType, dataBase64))
  }

  async getAttachment(id: string): Promise<Attachment & { path: string }> {
    return unwrap(await commands.getAttachment(id))
  }

  async deleteAttachment(id: string): Promise<void> {
    unwrap(await commands.deleteAttachment(id))
  }

  async openAttachment(id: string): Promise<void> {
    unwrap(await commands.openAttachment(id))
  }

  async saveBlock(_block: Block): Promise<void> {
    throw new Error('TauriIPCAdapter.saveBlock not implemented')
  }

  async saveInkLayer(pageId: string, dataUrl: string): Promise<void> {
    unwrap(await commands.saveInkLayer(pageId, dataUrl))
  }

  async getInkLayer(pageId: string): Promise<string | null> {
    return unwrap(await commands.getInkLayer(pageId))
  }

  async addDictionaryWord(word: string): Promise<void> {
    unwrap(await commands.addDictionaryWord(word))
  }

  async listDictionaryWords(): Promise<string[]> {
    return unwrap(await commands.listDictionaryWords())
  }

  async mergeSegments(_idA: string, _idB: string): Promise<void> {
    throw new Error('TauriIPCAdapter.mergeSegments not implemented')
  }

  async search(query: string, notebookId: string): Promise<SearchResult[]> {
    return unwrap(await commands.search(query, notebookId))
  }


  async setPageMode(pageId: string, mode: 'canvas' | 'linear'): Promise<void> {
    unwrap(await commands.setPageMode(pageId, mode))
  }


  onSyncEvent(_handler: (event: SyncEvent) => void): () => void {
    throw new Error('TauriIPCAdapter.onSyncEvent not implemented')
  }

  aiComplete(prompt: string, context: string, providerId?: string): AsyncIterableIterator<string> {
    return pushIterator<string>((sink) => {
      let streamId: number | null = null
      let stopped = false
      const channel = new Channel<AiStreamEvent>()
      channel.onmessage = (event) => {
        if (event.type === 'text') sink.push(event.text)
        else if (event.type === 'done') sink.end()
        else sink.fail(new Error(event.message))
      }
      commands.aiComplete(prompt, context, providerId ?? null, channel).then(
        (result) => {
          if (result.status === 'error') return sink.fail(new Error(result.error))
          streamId = result.data
          if (stopped) void commands.aiCancel(streamId)
        },
        (err: unknown) => sink.fail(err instanceof Error ? err : new Error(String(err))),
      )
      // Stopped early: cancel the request in the backend (once its id is known).
      return () => {
        stopped = true
        if (streamId !== null) void commands.aiCancel(streamId)
      }
    })
  }

  async listAiProviders(): Promise<AiProvider[]> {
    return unwrap(await commands.listAiProviders()) as AiProvider[]
  }

  // Sent as plain JSON so `apiKey`'s three meanings survive (see AiProviderInput).
  async saveAiProvider(provider: AiProviderInput): Promise<AiProvider> {
    return unwrap(await commands.saveAiProvider(provider as unknown as JsonValue)) as AiProvider
  }

  async deleteAiProvider(id: string): Promise<void> {
    unwrap(await commands.deleteAiProvider(id))
  }

  async setDefaultAiProvider(id: string): Promise<void> {
    unwrap(await commands.setDefaultAiProvider(id))
  }

  // A manifest is free-form JSON on the Rust side (it can carry fields the
  // backend doesn't model), so specta types it as `JsonValue`; the backend
  // has already validated it and filled in `PluginManifest`'s fields
  // (flownote_core::store::install_plugin / manifest_response).
  async installPlugin(source: string): Promise<PluginManifest> {
    return unwrap(await commands.installPlugin(source)) as unknown as PluginManifest
  }


  async uninstallPlugin(id: string): Promise<void> {
    unwrap(await commands.uninstallPlugin(id))
  }


  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    unwrap(await commands.setPluginEnabled(id, enabled))
  }


  async getInstalledPlugins(): Promise<PluginManifest[]> {
    return unwrap(await commands.getInstalledPlugins()) as unknown as PluginManifest[]
  }


  async pluginStorageGet(pluginId: string, key: string): Promise<string | null> {
    return unwrap(await commands.pluginStorageGet(pluginId, key))
  }


  async pluginStorageSet(pluginId: string, key: string, value: string): Promise<void> {
    unwrap(await commands.pluginStorageSet(pluginId, key, value))
  }


  async pluginStorageDelete(pluginId: string, key: string): Promise<void> {
    unwrap(await commands.pluginStorageDelete(pluginId, key))
  }


  async pluginStorageList(pluginId: string): Promise<string[]> {
    return unwrap(await commands.pluginStorageList(pluginId))
  }

  async pluginContentSecurityPolicy(pluginId: string, origin: string): Promise<string> {
    return unwrap(await commands.pluginContentSecurityPolicy(pluginId, origin))
  }

}
