import type { IPCAdapter, SyncStatus } from '@flownote/ipc-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasStore } from './canvasStore'
import { useNotebookStore } from './notebookStore'
import { startSync, useSyncStore } from './syncStore'

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  state: 'idle',
  target: 'folder',
  folderPath: '/sync',
  accountLabel: null,
  signingIn: false,
  deviceId: 'd1',
  deviceName: 'Laptop',
  connected: true,
  lastSyncAt: Date.now(),
  lastError: null,
  heldBack: null,
  quarantined: 0,
  waiting: 0,
  peers: [],
  vaultExists: null,
  ...over,
})

beforeEach(() => {
  useSyncStore.setState({ status: null, pageRevs: {}, conflictSegmentIds: [], signInUrl: null })
  useNotebookStore.setState({ selectedFileId: 'p1' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('syncStore.handleEvent', () => {
  it('keeps the latest status and conflict copies', async () => {
    await useSyncStore.getState().handleEvent({ type: 'status', status: status({ state: 'syncing' }) })
    expect(useSyncStore.getState().status?.state).toBe('syncing')
    await useSyncStore.getState().handleEvent({ type: 'conflict', segmentIds: ['c1'] })
    await useSyncStore.getState().handleEvent({ type: 'conflict', segmentIds: ['c1', 'c2'] })
    expect(useSyncStore.getState().conflictSegmentIds).toEqual(['c1', 'c2'])
  })

  it('reloads folders when they changed, and the open page only if it changed', async () => {
    const reload = vi.spyOn(useNotebookStore.getState(), 'reloadFromIPC').mockResolvedValue()
    const apply = vi.spyOn(useCanvasStore.getState(), 'applyRemoteSegments').mockResolvedValue()

    await useSyncStore.getState().handleEvent({ type: 'docsChanged', pageIds: ['p2'], folders: false })
    expect(reload).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(useSyncStore.getState().pageRevs).toEqual({ p2: 1 })

    await useSyncStore.getState().handleEvent({ type: 'docsChanged', pageIds: ['p1', 'p2'], folders: true })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('p1')
    expect(useSyncStore.getState().pageRevs).toEqual({ p1: 1, p2: 2 })
  })
})

describe('signIn events', () => {
  it('keep the sign-in link only while the sign-in waits', async () => {
    await useSyncStore.getState().handleEvent({ type: 'signIn', url: 'https://login.example/authorize?x=1' })
    expect(useSyncStore.getState().signInUrl).toBe('https://login.example/authorize?x=1')
    await useSyncStore.getState().handleEvent({ type: 'status', status: status({ state: 'needsSignIn', signingIn: true }) })
    expect(useSyncStore.getState().signInUrl).not.toBeNull()
    await useSyncStore.getState().handleEvent({ type: 'status', status: status({ state: 'needsPassphrase', signingIn: false }) })
    expect(useSyncStore.getState().signInUrl).toBeNull()
  })
})

describe('startSync', () => {
  function adapter(): IPCAdapter & { emit: (e: unknown) => void } {
    let handler: (e: unknown) => void = () => {}
    return {
      onSyncEvent: vi.fn((h) => {
        handler = h
        return vi.fn()
      }),
      getSyncStatus: vi.fn().mockResolvedValue(status()),
      syncNow: vi.fn().mockResolvedValue(status()),
      emit: (e: unknown) => handler(e),
    } as unknown as IPCAdapter & { emit: (e: unknown) => void }
  }

  it('loads the status and follows events', async () => {
    const ipc = adapter()
    const stop = startSync(ipc)
    await vi.waitFor(() => expect(useSyncStore.getState().status?.deviceName).toBe('Laptop'))
    ipc.emit({ type: 'status', status: status({ state: 'error', lastError: 'offline' }) })
    expect(useSyncStore.getState().status?.state).toBe('error')
    stop()
  })

  it('syncs on window focus only when connected and not synced recently', async () => {
    const ipc = adapter()
    const stop = startSync(ipc)
    await vi.waitFor(() => expect(useSyncStore.getState().status).not.toBeNull())
    window.dispatchEvent(new Event('focus'))
    expect(ipc.syncNow).not.toHaveBeenCalled() // just synced

    useSyncStore.setState({ status: status({ lastSyncAt: Date.now() - 60_000 }) })
    window.dispatchEvent(new Event('focus'))
    expect(ipc.syncNow).toHaveBeenCalledTimes(1)

    useSyncStore.setState({ status: status({ connected: false, lastSyncAt: null }) })
    window.dispatchEvent(new Event('focus'))
    expect(ipc.syncNow).toHaveBeenCalledTimes(1)

    stop()
    useSyncStore.setState({ status: status({ lastSyncAt: null }) })
    window.dispatchEvent(new Event('focus'))
    expect(ipc.syncNow).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the adapter has no sync events', () => {
    const ipc = { onSyncEvent: () => { throw new Error('no shell') } } as unknown as IPCAdapter
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => startSync(ipc)()).not.toThrow()
  })
})

describe('settings actions', () => {
  it('store the returned status, or report the error', async () => {
    const next = status({ state: 'needsPassphrase' })
    const ipc = {
      onSyncEvent: () => () => {},
      getSyncStatus: vi.fn().mockResolvedValue(status()),
      configureSync: vi.fn().mockResolvedValue(next),
      connectSync: vi.fn().mockRejectedValue(new Error('Wrong passphrase: no')),
      pickFolder: vi.fn().mockRejectedValue(new Error('not available')),
    } as unknown as IPCAdapter
    const stop = startSync(ipc)
    expect(await useSyncStore.getState().configure({ target: 'folder', folderPath: '/x' })).toEqual({ ok: true })
    expect(useSyncStore.getState().status).toEqual(next)
    expect(await useSyncStore.getState().connect('nope')).toEqual({ ok: false, error: 'Wrong passphrase: no' })
    expect(await useSyncStore.getState().pickFolder()).toBeUndefined()
    stop()
    expect(await useSyncStore.getState().syncNow()).toEqual({ ok: false, error: 'No backend connected.' })
  })
})
