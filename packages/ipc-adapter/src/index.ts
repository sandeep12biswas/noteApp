export * from './types'
export { ElectronIPCAdapter } from './electron'
export { TauriIPCAdapter } from './tauri'

import type { IPCAdapter } from './types'
import { ElectronIPCAdapter } from './electron'
import { TauriIPCAdapter } from './tauri'

declare global {
  interface Window {
    __TAURI__?: unknown
    // `electronTRPC` (not `electronIPC`) is electron-trpc's own global name —
    // set by apps/electron/src/preload.ts calling `exposeElectronTRPC()`
    // (see node_modules/electron-trpc's exposeElectronTRPC.ts). DESIGN.md
    // §3.3's original snippet named this `electronIPC`; corrected here to
    // match the actual library so detection works against the real preload.
    electronTRPC?: unknown
  }
}

// Platform detection per DESIGN.md §3.3. Frontend calls this once at
// startup and stores the result in Zustand; nothing else touches
// window.__TAURI__ / window.electronTRPC directly.
export async function resolveIPCAdapter(): Promise<IPCAdapter> {
  if (typeof window !== 'undefined' && window.__TAURI__) return new TauriIPCAdapter()
  if (typeof window !== 'undefined' && window.electronTRPC) return new ElectronIPCAdapter()
  throw new Error('No IPC transport found')
}
