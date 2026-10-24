import { afterEach, describe, expect, it } from 'vitest'
import { ElectronIPCAdapter, resolveIPCAdapter, TauriIPCAdapter } from './index'

afterEach(() => {
  delete window.__TAURI_INTERNALS__
  delete window.__TAURI__
  delete window.electronTRPC
})

describe('resolveIPCAdapter', () => {
  it('throws when neither Tauri nor Electron IPC is present', async () => {
    await expect(resolveIPCAdapter()).rejects.toThrow('No IPC transport found')
  })

  // Tauri v2 always injects `__TAURI_INTERNALS__`; `__TAURI__` only exists
  // with `app.withGlobalTauri`, which this app doesn't set.
  it('picks Tauri from __TAURI_INTERNALS__ alone', async () => {
    window.__TAURI_INTERNALS__ = {}
    expect(await resolveIPCAdapter()).toBeInstanceOf(TauriIPCAdapter)
  })

  it('still picks Tauri from the global __TAURI__', async () => {
    window.__TAURI__ = {}
    expect(await resolveIPCAdapter()).toBeInstanceOf(TauriIPCAdapter)
  })

  it('picks Electron from electronTRPC', async () => {
    window.electronTRPC = {}
    expect(await resolveIPCAdapter()).toBeInstanceOf(ElectronIPCAdapter)
  })
})
