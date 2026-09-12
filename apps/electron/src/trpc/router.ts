// electron-trpc router — DESIGN.md §3.2/§8.1/§8.2. Every procedure here is a
// thin pass-through to the Rust sidecar over the SidecarSupervisor; the
// procedure name is the wire-protocol `method` name from
// crates/flownote-electron/src/protocol.rs. Procedures for methods the
// sidecar doesn't implement yet reject with "method not implemented: <name>"
// (see protocol.rs's default match arm) — that's the same behavior
// packages/ipc-adapter's stub adapters already give the frontend, so
// wiring a new IPCAdapter method through end-to-end is just: implement it
// in protocol.rs, then flip its ElectronIPCAdapter method from a stub throw
// to a real trpc call.
import { initTRPC } from '@trpc/server'
import type { Folder, Segment } from '@flownote/ipc-adapter'
import type { SidecarSupervisor } from '../sidecarSupervisor'

export interface Context {
  sidecar: SidecarSupervisor
}

const t = initTRPC.context<Context>().create()

export const appRouter = t.router({
  ping: t.procedure.query(({ ctx }) => ctx.sidecar.request('ping')),

  getPage: t.procedure
    .input((pageId: unknown): string => {
      if (typeof pageId !== 'string') throw new Error('getPage expects a string pageId')
      return pageId
    })
    .query(({ ctx, input }) => ctx.sidecar.request('get_page', { pageId: input })),

  saveFolder: t.procedure
    .input((folder: unknown): Folder => folder as Folder)
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_folder', input)),

  listFolders: t.procedure.query(({ ctx }) => ctx.sidecar.request('list_folders')),

  savePage: t.procedure
    .input((page: unknown): { id: string; folderId: string; title: string } => page as never)
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_page', input)),

  listPages: t.procedure
    .input((folderId: unknown): string => {
      if (typeof folderId !== 'string') throw new Error('listPages expects a string folderId')
      return folderId
    })
    .query(({ ctx, input }) => ctx.sidecar.request('list_pages', { folderId: input })),

  deletePage: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('deletePage expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('delete_page', { id: input })),

  deleteFolder: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('deleteFolder expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('delete_folder', { id: input })),

  listSegments: t.procedure
    .input((pageId: unknown): string => {
      if (typeof pageId !== 'string') throw new Error('listSegments expects a string pageId')
      return pageId
    })
    .query(({ ctx, input }) => ctx.sidecar.request('list_segments', { pageId: input })),

  saveSegment: t.procedure
    .input((seg: unknown): Segment => seg as Segment)
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_segment', input)),

  saveSegmentsBatch: t.procedure
    .input((segs: unknown): Segment[] => segs as Segment[])
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_segments_batch', { segments: input })),

  deleteSegment: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('deleteSegment expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('delete_segment', { id: input })),

  saveInkLayer: t.procedure
    .input((input: unknown): { pageId: string; dataUrl: string } => input as never)
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_ink_layer', { pageId: input.pageId, dataUrl: input.dataUrl })),

  getInkLayer: t.procedure
    .input((pageId: unknown): string => {
      if (typeof pageId !== 'string') throw new Error('getInkLayer expects a string pageId')
      return pageId
    })
    .query(({ ctx, input }) => ctx.sidecar.request('get_ink_layer', { pageId: input })),

  addDictionaryWord: t.procedure
    .input((word: unknown): string => {
      if (typeof word !== 'string') throw new Error('addDictionaryWord expects a string word')
      return word
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('add_dictionary_word', { word: input })),

  listDictionaryWords: t.procedure.query(({ ctx }) => ctx.sidecar.request('list_dictionary_words', {})),

  setPageMode: t.procedure
    .input((input: unknown): { pageId: string; mode: 'canvas' | 'linear' } => input as never)
    .mutation(({ ctx, input }) => ctx.sidecar.request('set_page_mode', { pageId: input.pageId, mode: input.mode })),

  search: t.procedure
    .input((input: unknown): { query: string; notebookId: string } => input as never)
    .query(({ ctx, input }) => ctx.sidecar.request('search', { query: input.query, notebookId: input.notebookId })),

  installPlugin: t.procedure
    .input((source: unknown): string => {
      if (typeof source !== 'string') throw new Error('installPlugin expects a string source')
      return source
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('install_plugin', { source: input })),

  uninstallPlugin: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('uninstallPlugin expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('uninstall_plugin', { id: input })),

  setPluginEnabled: t.procedure
    .input((input: unknown): { id: string; enabled: boolean } => input as never)
    .mutation(({ ctx, input }) => ctx.sidecar.request('set_plugin_enabled', { id: input.id, enabled: input.enabled })),

  getInstalledPlugins: t.procedure.query(({ ctx }) => ctx.sidecar.request('get_installed_plugins')),

  pluginStorageGet: t.procedure
    .input((input: unknown): { pluginId: string; key: string } => input as never)
    .query(({ ctx, input }) => ctx.sidecar.request('plugin_storage_get', { pluginId: input.pluginId, key: input.key })),

  pluginStorageSet: t.procedure
    .input((input: unknown): { pluginId: string; key: string; value: string } => input as never)
    .mutation(({ ctx, input }) =>
      ctx.sidecar.request('plugin_storage_set', { pluginId: input.pluginId, key: input.key, value: input.value }),
    ),

  pluginStorageDelete: t.procedure
    .input((input: unknown): { pluginId: string; key: string } => input as never)
    .mutation(({ ctx, input }) => ctx.sidecar.request('plugin_storage_delete', { pluginId: input.pluginId, key: input.key })),

  pluginStorageList: t.procedure
    .input((pluginId: unknown): string => {
      if (typeof pluginId !== 'string') throw new Error('pluginStorageList expects a string pluginId')
      return pluginId
    })
    .query(({ ctx, input }) => ctx.sidecar.request('plugin_storage_list', { pluginId: input })),
})

export type AppRouter = typeof appRouter
