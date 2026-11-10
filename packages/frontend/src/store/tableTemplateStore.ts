// Table templates (issue #38) — the app-wide list, loaded from and saved
// through the IPCAdapter (SQLite `table_templates`, both desktop shells),
// so templates survive restarts and every page sees the same list.
import type { TableTemplate, TableTemplateInput } from '@flownote/ipc-adapter'
import { create } from 'zustand'
import { getIPCAdapter } from './notebookStore'

interface TableTemplateState {
  templates: TableTemplate[]
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  /** Saves (replacing one with the same name, ignoring case — confirm first with `findByName`). */
  save: (template: TableTemplateInput) => Promise<{ ok: boolean; error?: string }>
  rename: (from: string, to: string) => Promise<{ ok: boolean; error?: string }>
  remove: (name: string) => Promise<{ ok: boolean; error?: string }>
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const NO_BACKEND = 'Templates need the desktop app (no backend connected).'

export function findByName(templates: readonly TableTemplate[], name: string): TableTemplate | undefined {
  const key = name.trim().toLowerCase()
  return templates.find((t) => t.name.toLowerCase() === key)
}

export const useTableTemplateStore = create<TableTemplateState>((set, get) => {
  const run = async (fn: (ipc: NonNullable<ReturnType<typeof getIPCAdapter>>) => Promise<void>) => {
    const ipc = getIPCAdapter()
    if (!ipc) return { ok: false, error: NO_BACKEND }
    try {
      await fn(ipc)
      await get().load()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }
  return {
    templates: [],
    loaded: false,
    error: null,
    load: async () => {
      const ipc = getIPCAdapter()
      if (!ipc) return
      try {
        set({ templates: await ipc.listTableTemplates(), loaded: true, error: null })
      } catch (err) {
        set({ loaded: true, error: message(err) })
      }
    },
    save: (template) => run((ipc) => ipc.saveTableTemplate({ ...template, name: template.name.trim() })),
    rename: (from, to) => run((ipc) => ipc.renameTableTemplate(from, to.trim())),
    remove: (name) => run((ipc) => ipc.deleteTableTemplate(name)),
  }
})
