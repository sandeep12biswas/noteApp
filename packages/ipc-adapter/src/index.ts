export * from './types'
export { ElectronIPCAdapter } from './electron'
export { TauriIPCAdapter } from './tauri'

import type { IPCAdapter } from './types'
import { ElectronIPCAdapter } from './electron'
import { TauriIPCAdapter } from './tauri'

declare global {
  interface Window {
    __TAURI__?: unknown
    electronIPC?: unknown
  }
}

// Platform detection per DESIGN.md §3.3. Frontend calls this once at
// startup and stores the result in Zustand; nothing else touches
// window.__TAURI__ / window.electronIPC directly.
export async function resolveIPCAdapter(): Promise<IPCAdapter> {
  if (typeof window !== 'undefined' && window.__TAURI__) return new TauriIPCAdapter()
  if (typeof window !== 'undefined' && window.electronIPC) return new ElectronIPCAdapter()
  throw new Error('No IPC transport found')
}
