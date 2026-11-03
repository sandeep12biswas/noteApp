export * from './types'
export { ElectronIPCAdapter } from './electron'
export { TauriIPCAdapter } from './tauri'

import type { IPCAdapter } from './types'
import { ElectronIPCAdapter } from './electron'
import { TauriIPCAdapter } from './tauri'

declare global {
  interface Window {
    // Injected by Tauri v2 into every webview — what @tauri-apps/api's
    // `invoke()` (and so the generated bindings) actually call through.
    __TAURI_INTERNALS__?: unknown
    // Only present when tauri.conf.json sets `app.withGlobalTauri`, which
    // this app doesn't — kept as a fallback, not relied on.
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
  // Detecting only `__TAURI__` (DESIGN.md §3.3's original snippet) missed
  // the real Tauri shell entirely: App.tsx then silently fell back to
  // client-only state, so nothing a Windows/macOS user did was ever saved.
  if (typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__)) return new TauriIPCAdapter()
  if (typeof window !== 'undefined' && window.electronTRPC) return new ElectronIPCAdapter()
  throw new Error('No IPC transport found')
}
