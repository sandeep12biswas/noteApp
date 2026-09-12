// Installed-plugin state — DESIGN.md §9.5 Plugin Manager UI. Both
// `PluginManager` (creates/destroys sandboxed iframes for enabled plugins)
// and the Plugin Manager UI (`packages/frontend/src/layout/PluginManagerUI.tsx`)
// read from this one store, so installing/enabling/disabling/uninstalling a
// plugin through the UI takes effect immediately — no reload needed —
// rather than each maintaining its own private fetch of the same data.
import type { PluginManifest } from '@flownote/ipc-adapter'
import { create } from 'zustand'
import { getIPCAdapter } from './notebookStore'

interface PluginState {
  plugins: PluginManifest[]
  loading: boolean
  error: string | null

  loadPlugins: () => Promise<void>
  install: (source: string) => Promise<{ ok: boolean; error?: string }>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  uninstall: (id: string) => Promise<void>
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  loading: false,
  error: null,

  loadPlugins: async () => {
    const ipc = getIPCAdapter()
    if (!ipc) return
    set({ loading: true, error: null })
    try {
      const plugins = await ipc.getInstalledPlugins()
      set({ plugins, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  install: async (source) => {
    const ipc = getIPCAdapter()
    if (!ipc) return { ok: false, error: 'No backend connected.' }
    try {
      await ipc.installPlugin(source)
      await get().loadPlugins()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  setEnabled: async (id, enabled) => {
    const ipc = getIPCAdapter()
    if (!ipc) return
    set((state) => ({ plugins: state.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)) }))
    await ipc.setPluginEnabled(id, enabled).catch(() => get().loadPlugins())
  },

  uninstall: async (id) => {
    const ipc = getIPCAdapter()
    if (!ipc) return
    await ipc.uninstallPlugin(id)
    set((state) => ({ plugins: state.plugins.filter((p) => p.id !== id) }))
  },
}))
