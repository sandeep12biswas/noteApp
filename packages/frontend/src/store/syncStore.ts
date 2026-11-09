// Sync state for the frontend (sync step S5). The backend syncs on its own
// (flownote_core::sync::service); this store keeps its latest status and
// applies what other devices changed:
// - `docsChanged` with `folders` → folders/pages and the personal
//   dictionary are loaded again;
// - `docsChanged` for the open page → its segments reload in place
//   (`canvasStore.applyRemoteSegments`), and `pageRevs` makes InkLayer
//   reload the page's ink;
// - `conflict` → the conflict copies' ids are kept for the UI (S7);
// - `signIn` → the sign-in URL is kept while the sign-in waits, so the UI can
//   offer it as a link if the browser didn't open.
// The Sync settings screen and status-bar indicator (S7) read `status`.
import type { IPCAdapter, SyncCloudTarget, SyncConfigInput, SyncEvent, SyncStatus } from '@flownote/ipc-adapter'
import { create } from 'zustand'
import { hydratePersonalDictionary } from '../lib/spellcheck'
import { useCanvasStore } from './canvasStore'
import { useNotebookStore } from './notebookStore'

/** On window focus, sync if the last sync is older than this. */
const FOCUS_SYNC_AFTER_MS = 30_000

let ipc: IPCAdapter | null = null

/** What a settings action resolved to: the new status is already in the store. */
export type SyncActionResult = { ok: true } | { ok: false; error: string }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface SyncStoreState {
  status: SyncStatus | null
  /** Per page, bumped whenever another device changed it. */
  pageRevs: Record<string, number>
  /** Conflict copies created by sync this session. */
  conflictSegmentIds: string[]
  /** The cloud sign-in page while a sign-in waits in the browser. */
  signInUrl: string | null
  handleEvent: (event: SyncEvent) => Promise<void>
  // Settings actions (the Sync settings dialog, status bar, mass-delete banner).
  configure: (input: SyncConfigInput) => Promise<SyncActionResult>
  /** Resolves when the browser sign-in finishes, fails or is cancelled. */
  signIn: (target: SyncCloudTarget) => Promise<SyncActionResult>
  cancelSignIn: () => Promise<SyncActionResult>
  connect: (passphrase: string) => Promise<SyncActionResult>
  syncNow: () => Promise<SyncActionResult>
  confirmMassDelete: () => Promise<SyncActionResult>
  disconnect: () => Promise<SyncActionResult>
  /** The OS folder dialog: a path, `null` if cancelled, `undefined` where there's none (type the path). */
  pickFolder: () => Promise<string | null | undefined>
}

function logFailure(what: string) {
  return (err: unknown) => {
    // eslint-disable-next-line no-console -- best-effort reload; the next sync event retries
    console.error(`syncStore: ${what} failed`, err)
  }
}

export const useSyncStore = create<SyncStoreState>((set, get) => {
  const run = async (call: (ipc: IPCAdapter) => Promise<SyncStatus>): Promise<SyncActionResult> => {
    if (!ipc) return { ok: false, error: 'No backend connected.' }
    try {
      set({ status: await call(ipc) })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }
  return {
    status: null,
    pageRevs: {},
    conflictSegmentIds: [],
    signInUrl: null,

    handleEvent: async (event) => {
      switch (event.type) {
        case 'status':
          set({ status: event.status, ...(event.status.signingIn ? {} : { signInUrl: null }) })
          return
        case 'signIn':
          set({ signInUrl: event.url })
          return
        case 'conflict':
          set({ conflictSegmentIds: [...new Set([...get().conflictSegmentIds, ...event.segmentIds])] })
          return
        case 'docsChanged': {
          if (event.pageIds.length > 0) {
            const pageRevs = { ...get().pageRevs }
            for (const id of event.pageIds) pageRevs[id] = (pageRevs[id] ?? 0) + 1
            set({ pageRevs })
          }
          const work: Promise<void>[] = []
          if (event.folders) {
            work.push(useNotebookStore.getState().reloadFromIPC().catch(logFailure('reloading folders and pages')))
            work.push(hydratePersonalDictionary().catch(logFailure('reloading the dictionary')))
          }
          const open = useNotebookStore.getState().selectedFileId
          if (open && event.pageIds.includes(open)) {
            work.push(useCanvasStore.getState().applyRemoteSegments(open).catch(logFailure('reloading the open page')))
          }
          await Promise.all(work)
          return
        }
      }
    },

    configure: (input) => run((i) => i.configureSync(input)),
    signIn: (target) => run((i) => i.signInSync(target)),
    cancelSignIn: () => run((i) => i.cancelSyncSignIn()),
    connect: (passphrase) => run((i) => i.connectSync(passphrase)),
    syncNow: () => run((i) => i.syncNow()),
    confirmMassDelete: () => run((i) => i.confirmSyncMassDelete()),
    disconnect: () => run((i) => i.disconnectSync()),
    pickFolder: async () => {
      if (!ipc) return undefined
      try {
        return await ipc.pickFolder()
      } catch {
        return undefined
      }
    },
  }
})

/**
 * Called once at startup (App.tsx): loads the status, follows sync events,
 * and syncs when the window regains focus after a while. Returns a function
 * that undoes all of it.
 */
export function startSync(adapter: IPCAdapter): () => void {
  ipc = adapter
  const stopFollowing = followSync(adapter)
  return () => {
    stopFollowing()
    ipc = null
  }
}

function followSync(ipc: IPCAdapter): () => void {
  let unsubscribe: () => void = () => {}
  try {
    unsubscribe = ipc.onSyncEvent((event) => void useSyncStore.getState().handleEvent(event))
  } catch (err) {
    logFailure('subscribing to sync events')(err)
    return () => {}
  }
  ipc.getSyncStatus().then(
    (status) => useSyncStore.setState((s) => (s.status ? {} : { status })),
    logFailure('loading the sync status'),
  )
  const onFocus = () => {
    const status = useSyncStore.getState().status
    if (!status?.connected || status.state === 'syncing') return
    if (Date.now() - (status.lastSyncAt ?? 0) < FOCUS_SYNC_AFTER_MS) return
    ipc.syncNow().catch(logFailure('syncing on focus'))
  }
  window.addEventListener('focus', onFocus)
  return () => {
    unsubscribe()
    window.removeEventListener('focus', onFocus)
  }
}
