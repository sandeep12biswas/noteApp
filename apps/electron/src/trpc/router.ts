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
import { observable } from '@trpc/server/observable'
import type { ButtonLayout, ButtonTheme, Folder, Segment } from '@flownote/ipc-adapter'
import type { SidecarSupervisor } from '../sidecarSupervisor'

export interface Context {
  sidecar: SidecarSupervisor
  /** `shell.openPath` (main.ts) — injected rather than importing `electron` here directly, same reasoning as `sidecar` itself. */
  openPath: (path: string) => Promise<string>
  /** The native "choose a folder" dialog (main.ts); `null` if cancelled. */
  pickFolder: () => Promise<string | null>
  /** The calling window, for the frameless title bar (packages/frontend/src/layout/TitleBar.tsx). */
  window: {
    /** True when the native frame is hidden and the renderer must draw the buttons. */
    frameless: boolean
    /** True when the window is transparent so the renderer can round its corners (main.ts ROUNDED_WINDOW). */
    rounded: boolean
    /** The desktop's button placement (buttonLayout.ts). */
    buttonLayout: () => ButtonLayout
    /** The desktop theme's button artwork, or null (windowTheme.ts). */
    buttonTheme: () => ButtonTheme | null
    isMaximized: () => boolean
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  }
}

const t = initTRPC.context<Context>().create()

export const appRouter = t.router({
  ping: t.procedure.query(({ ctx }) => ctx.sidecar.request('ping')),

  // Window controls for the renderer-drawn title bar — main-process only,
  // never forwarded to the sidecar.
  windowChrome: t.procedure.query(({ ctx }) => ({
    frameless: ctx.window.frameless,
    rounded: ctx.window.frameless && ctx.window.rounded,
    layout: ctx.window.buttonLayout(),
    theme: ctx.window.frameless ? ctx.window.buttonTheme() : null,
  })),
  windowIsMaximized: t.procedure.query(({ ctx }) => ctx.window.isMaximized()),
  windowMinimize: t.procedure.mutation(({ ctx }) => ctx.window.minimize()),
  windowToggleMaximize: t.procedure.mutation(({ ctx }) => ctx.window.toggleMaximize()),
  windowClose: t.procedure.mutation(({ ctx }) => ctx.window.close()),

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

  saveAttachment: t.procedure
    .input((input: unknown): { id: string; segmentId: string; fileName: string; mimeType: string; dataBase64: string } => input as never)
    .mutation(({ ctx, input }) =>
      ctx.sidecar.request('save_attachment', {
        id: input.id,
        segmentId: input.segmentId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
      }),
    ),

  getAttachment: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('getAttachment expects a string id')
      return id
    })
    .query(({ ctx, input }) => ctx.sidecar.request('get_attachment', { id: input })),

  deleteAttachment: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('deleteAttachment expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('delete_attachment', { id: input })),

  openAttachment: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('openAttachment expects a string id')
      return id
    })
    .mutation(async ({ ctx, input }) => {
      const attachment = (await ctx.sidecar.request('get_attachment', { id: input })) as { path: string }
      await ctx.openPath(attachment.path)
    }),

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

  // Table templates (issue #38).
  listTableTemplates: t.procedure.query(({ ctx }) => ctx.sidecar.request('list_table_templates', {})),
  saveTableTemplate: t.procedure
    .input((raw: unknown) => {
      const t = raw as { name?: unknown; table?: unknown; includesContents?: unknown }
      if (typeof t?.name !== 'string' || typeof t.table !== 'object' || t.table === null) throw new Error('saveTableTemplate expects { name, table, includesContents }')
      return { name: t.name, table: t.table, includesContents: t.includesContents === true }
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_table_template', input)),
  renameTableTemplate: t.procedure
    .input((raw: unknown) => {
      const r = raw as { from?: unknown; to?: unknown }
      if (typeof r?.from !== 'string' || typeof r.to !== 'string') throw new Error('renameTableTemplate expects { from, to }')
      return { from: r.from, to: r.to }
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('rename_table_template', input)),
  deleteTableTemplate: t.procedure
    .input((raw: unknown) => {
      if (typeof raw !== 'string') throw new Error('deleteTableTemplate expects a template name')
      return raw
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('delete_table_template', { name: input })),

  setPageMode: t.procedure
    .input((input: unknown): { pageId: string; mode: 'canvas' | 'linear' } => input as never)
    .mutation(({ ctx, input }) => ctx.sidecar.request('set_page_mode', { pageId: input.pageId, mode: input.mode })),

  setPageBackground: t.procedure
    .input((input: unknown): { pageId: string; background: string | null } => input as never)
    .mutation(({ ctx, input }) =>
      ctx.sidecar.request('set_page_background', { pageId: input.pageId, background: input.background }),
    ),

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

  pluginContentSecurityPolicy: t.procedure
    .input((input: unknown): { pluginId: string; origin: string } => {
      const i = input as { pluginId?: unknown; origin?: unknown }
      if (typeof i?.pluginId !== 'string' || typeof i?.origin !== 'string') {
        throw new Error('pluginContentSecurityPolicy expects { pluginId: string, origin: string }')
      }
      return { pluginId: i.pluginId, origin: i.origin }
    })
    .query(({ ctx, input }) => ctx.sidecar.request('plugin_csp', input)),

  // ---- AI (flownote_core::ai / store) ----
  listAiProviders: t.procedure.query(({ ctx }) => ctx.sidecar.request('list_ai_providers')),

  saveAiProvider: t.procedure
    .input((input: unknown): Record<string, unknown> => {
      if (typeof input !== 'object' || input === null) throw new Error('saveAiProvider expects an object')
      return input as Record<string, unknown>
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('save_ai_provider', input)),

  deleteAiProvider: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('deleteAiProvider expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('delete_ai_provider', { id: input })),

  setDefaultAiProvider: t.procedure
    .input((id: unknown): string => {
      if (typeof id !== 'string') throw new Error('setDefaultAiProvider expects a string id')
      return id
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('set_default_ai_provider', { id: input })),

  pickFolder: t.procedure.mutation(({ ctx }) => ctx.pickFolder()),

  // ---- Sync (flownote_core::sync::service, step S5) ----
  syncStatus: t.procedure.query(({ ctx }) => ctx.sidecar.request('sync_status')),

  syncConfigure: t.procedure
    .input((input: unknown): Record<string, unknown> => {
      if (typeof input !== 'object' || input === null) throw new Error('syncConfigure expects an object')
      return input as Record<string, unknown>
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('sync_configure', input)),

  syncConnect: t.procedure
    .input((passphrase: unknown): string => {
      if (typeof passphrase !== 'string') throw new Error('syncConnect expects a string passphrase')
      return passphrase
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('sync_connect', { passphrase: input })),

  /** Resolves once the browser sign-in finishes (the sidecar opens the browser). */
  syncSignIn: t.procedure
    .input((target: unknown): string => {
      if (target !== 'onedrive' && target !== 'gdrive') throw new Error("syncSignIn expects 'onedrive' or 'gdrive'")
      return target
    })
    .mutation(({ ctx, input }) => ctx.sidecar.request('sync_sign_in', { target: input })),

  syncCancelSignIn: t.procedure.mutation(({ ctx }) => ctx.sidecar.request('sync_cancel_sign_in')),

  syncNow: t.procedure.mutation(({ ctx }) => ctx.sidecar.request('sync_now')),

  syncConfirmMassDelete: t.procedure.mutation(({ ctx }) => ctx.sidecar.request('sync_confirm_mass_delete')),

  syncDisconnect: t.procedure.mutation(({ ctx }) => ctx.sidecar.request('sync_disconnect')),

  /** The sidecar's `sync` event lines (status, docsChanged, conflict), passed through as they arrive. */
  onSyncEvent: t.procedure.subscription(({ ctx }) =>
    observable<unknown>((emit) => ctx.sidecar.onEvent((event, data) => {
      if (event === 'sync') emit.next(data)
    })),
  ),

  /**
   * Streams generated text: `{ type: 'text', text }` per piece, then
   * `{ type: 'done' }`; a provider/transport failure ends it with an error.
   * Unsubscribing (the user pressed Stop) cancels the request in the sidecar.
   */
  aiComplete: t.procedure
    .input((input: unknown): { prompt: string; context: string; providerId?: string } => {
      const i = input as { prompt?: unknown; context?: unknown; providerId?: unknown }
      if (typeof i?.prompt !== 'string') throw new Error('aiComplete expects { prompt: string, context?: string }')
      return {
        prompt: i.prompt,
        context: typeof i.context === 'string' ? i.context : '',
        ...(typeof i.providerId === 'string' ? { providerId: i.providerId } : {}),
      }
    })
    .subscription(({ ctx, input }) =>
      observable<{ type: 'text'; text: string } | { type: 'done' }>((emit) => {
        let finished = false
        const stream = ctx.sidecar.requestStream('ai_complete', input, (text) => emit.next({ type: 'text', text }))
        stream.done.then(
          () => {
            finished = true
            emit.next({ type: 'done' })
            emit.complete()
          },
          (err: unknown) => {
            finished = true
            emit.error(err instanceof Error ? err : new Error(String(err)))
          },
        )
        return () => {
          if (!finished) void ctx.sidecar.request('ai_cancel', { streamId: stream.id }).catch(() => {})
        }
      }),
    ),
})

export type AppRouter = typeof appRouter
