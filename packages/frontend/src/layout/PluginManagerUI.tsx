// Plugin Manager UI — DESIGN.md §9.5. Just the **Installed** sub-view this
// session (list, permissions, hot enable/disable, uninstall with
// confirmation, and installing from a local manifest). **Browse** (a real
// plugin registry) and **Developer** (local-folder hot-reload) are real
// follow-up work — this scope's "core plugin system" deliberately covers
// the runtime (registry, sandbox, IPC bridge, storage isolation) over the
// authoring/discovery tooling around it.
import { type FormEvent, useEffect, useState } from 'react'
import type { PluginManifest } from '@flownote/ipc-adapter'
import { usePluginStore } from '../store/pluginStore'

function InstallForm({ onClose }: { onClose: () => void }) {
  const install = usePluginStore((s) => s.install)
  const [manifestText, setManifestText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await install(manifestText)
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.error ?? 'Could not install plugin.')
  }

  return (
    <form
      onSubmit={submit}
      role="dialog"
      aria-label="Install plugin"
      className="absolute inset-x-4 top-14 z-10 flex flex-col gap-2 rounded border border-gray-300 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <p className="text-sm font-medium">Install from manifest</p>
      <textarea
        aria-label="Plugin manifest JSON"
        rows={8}
        className="rounded border border-gray-300 p-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800"
        value={manifestText}
        onChange={(e) => setManifestText(e.target.value)}
        placeholder='{"id": "com.example.plugin", "name": "...", "version": "1.0.0", ...}'
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm text-gray-500">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-2 py-1 text-sm text-white disabled:opacity-50">
          {busy ? 'Installing…' : 'Install'}
        </button>
      </div>
    </form>
  )
}

function PluginRow({ plugin }: { plugin: PluginManifest }) {
  const setEnabled = usePluginStore((s) => s.setEnabled)
  const uninstall = usePluginStore((s) => s.uninstall)
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  return (
    <li className="flex items-center justify-between gap-3 border-b border-gray-100 py-2 dark:border-gray-800">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{plugin.name}</span>
          <span className="text-xs text-gray-400">v{plugin.version}</span>
        </div>
        {plugin.description && <p className="truncate text-xs text-gray-500">{plugin.description}</p>}
        {plugin.permissions.length > 0 && (
          <p className="text-[11px] text-gray-400">Permissions: {plugin.permissions.join(', ')}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
            checked={plugin.enabled}
            onChange={(e) => setEnabled(plugin.id, e.target.checked)}
          />
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </label>
        {confirmingUninstall ? (
          <span className="flex items-center gap-1 text-xs">
            Uninstall?
            <button type="button" className="text-red-600" onClick={() => uninstall(plugin.id)}>
              Yes
            </button>
            <button type="button" className="text-gray-500" onClick={() => setConfirmingUninstall(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" aria-label={`Uninstall ${plugin.name}`} className="text-xs text-red-600" onClick={() => setConfirmingUninstall(true)}>
            Uninstall
          </button>
        )}
      </div>
    </li>
  )
}

export function PluginManagerUI() {
  const plugins = usePluginStore((s) => s.plugins)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  return (
    <section className="relative flex-1 overflow-y-auto p-4" data-testid="plugin-manager-ui" aria-label="Plugin Manager">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium">Plugins</h2>
        <button
          type="button"
          onClick={() => setShowInstall(true)}
          className="rounded bg-blue-600 px-2 py-1 text-sm text-white"
        >
          Install…
        </button>
      </div>
      {plugins.length === 0 ? (
        <p className="text-sm text-gray-400">No plugins installed.</p>
      ) : (
        <ul aria-label="Installed plugins">
          {plugins.map((p) => (
            <PluginRow key={p.id} plugin={p} />
          ))}
        </ul>
      )}
      {showInstall && <InstallForm onClose={() => setShowInstall(false)} />}
    </section>
  )
}
