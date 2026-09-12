import { useEffect } from 'react'
import { resolveIPCAdapter } from '@flownote/ipc-adapter'
import { AppShell } from './layout/AppShell'
import { setIPCAdapter as setCanvasIPCAdapter } from './store/canvasStore'
import { setIPCAdapter as setInkIPCAdapter } from './canvas/InkLayer'
import { hydratePersonalDictionary, setIPCAdapter as setSpellIPCAdapter } from './lib/spellcheck'
import { setIPCAdapter as setNotebookIPCAdapter, useNotebookStore } from './store/notebookStore'

export default function App() {
  useEffect(() => {
    // Resolves once at startup (DESIGN.md §3.3) and injects the same
    // adapter instance into both stores so every mutation persists through
    // real SQLite storage ("IPCAdapter calls wired", EXECUTION_PLAN.md
    // Phase 2). Outside a real Electron/Tauri shell (e.g. `vite dev` in a
    // browser) this rejects and the app just runs with client-only state,
    // same as before this wiring existed.
    resolveIPCAdapter()
      .then(async (ipc) => {
        setNotebookIPCAdapter(ipc)
        setCanvasIPCAdapter(ipc)
        setInkIPCAdapter(ipc)
        setSpellIPCAdapter(ipc)
        await useNotebookStore.getState().hydrateFromIPC()
        await hydratePersonalDictionary()
      })
      .catch(() => {
        // No IPC transport (e.g. running the frontend standalone in a
        // browser for development) — client-only state, nothing to do.
      })
  }, [])

  return <AppShell />
}
