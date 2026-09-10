// Preload bridge — DESIGN.md §3.2/§3.3/§8.1. Exposes `window.electronTRPC`
// (electron-trpc's own convention, not a FlowNote-specific name) via
// contextBridge so the renderer's ElectronIPCAdapter can talk to the
// appRouter in trpc/router.ts over Electron's native IPC. This is the only
// thing the preload script does — no other Node/Electron API is exposed to
// the renderer, keeping the sandbox boundary from DESIGN.md §3.3 intact.
import { exposeElectronTRPC } from 'electron-trpc/main'

process.once('loaded', () => {
  exposeElectronTRPC()
})
