// PluginManager — DESIGN.md §9.8. What's testable in jsdom (no real
// scripting/loading of iframe content, no blob: URL navigation): that it
// creates exactly one sandboxed iframe per *enabled* plugin, with the
// sandbox attribute that actually enforces DESIGN.md §9.1 ("no DOM access,
// no localStorage"), and cleans them up. The `load`-triggered registration
// handshake itself is covered by PluginIPCBridge.test.ts's message-handling
// tests and by manual QA — jsdom doesn't drive that.
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PluginManager } from './PluginManager'
import { usePluginStore } from '../store/pluginStore'
import { setIPCAdapter } from '../store/notebookStore'

function iframes(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll('iframe'))
}

afterEach(() => {
  cleanup()
  setIPCAdapter(null)
  usePluginStore.setState({ plugins: [], loading: false, error: null })
  for (const f of iframes()) f.remove()
})

beforeEach(() => {
  usePluginStore.setState({ plugins: [], loading: false, error: null })
})

const manifest = (overrides: Partial<{ id: string; enabled: boolean }> = {}) => ({
  id: overrides.id ?? 'com.sandeep.spreadsheet',
  name: 'Spreadsheet',
  version: '1.0.0',
  description: '',
  author: '',
  entry: 'index.js',
  sdkVersion: '1.0.0',
  permissions: ['storage:read', 'storage:write'],
  extensionPoints: ['blockType:spreadsheet'],
  minAppVersion: '*',
  enabled: overrides.enabled ?? true,
  installedAt: 0,
})

describe('PluginManager', () => {
  it('creates a sandboxed iframe (no allow-same-origin) for each enabled plugin', async () => {
    setIPCAdapter({
      getInstalledPlugins: async () => [manifest()],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<PluginManager />)

    await waitFor(() => expect(iframes()).toHaveLength(1))
    const frame = iframes()[0]!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('does not create an iframe for a disabled plugin', async () => {
    setIPCAdapter({
      getInstalledPlugins: async () => [manifest({ enabled: false })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<PluginManager />)
    await waitFor(() => expect(usePluginStore.getState().plugins).toHaveLength(1))
    expect(iframes()).toHaveLength(0)
  })

  it('creates one iframe per enabled plugin when there are several', async () => {
    setIPCAdapter({
      getInstalledPlugins: async () => [manifest({ id: 'plugin-a' }), manifest({ id: 'plugin-b' }), manifest({ id: 'plugin-c', enabled: false })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<PluginManager />)
    await waitFor(() => expect(iframes()).toHaveLength(2))
  })

  it('removes the iframe when the plugin is disabled via the store', async () => {
    setIPCAdapter({
      getInstalledPlugins: async () => [manifest()],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<PluginManager />)
    await waitFor(() => expect(iframes()).toHaveLength(1))

    usePluginStore.setState((s) => ({ plugins: s.plugins.map((p) => ({ ...p, enabled: false })) }))
    await waitFor(() => expect(iframes()).toHaveLength(0))
  })

  it('removes all iframes on unmount', async () => {
    setIPCAdapter({
      getInstalledPlugins: async () => [manifest()],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const { unmount } = render(<PluginManager />)
    await waitFor(() => expect(iframes()).toHaveLength(1))
    unmount()
    expect(iframes()).toHaveLength(0)
  })
})

describe('pluginAssetUrl', () => {
  // Regression test for a real bug found via live QA (run-electron): under
  // Electron's `file://` loading, a root-absolute path like
  // "/plugins/<id>/x" resolves to the filesystem root, not this app's own
  // asset directory — "Not allowed to load local resource:
  // file:///plugins/...". Must always resolve against `document.baseURI`.
  it('never returns a root-absolute path', async () => {
    const { pluginAssetUrl } = await import('./PluginManager')
    const url = pluginAssetUrl('com.sandeep.spreadsheet', 'grid.html')
    expect(url.startsWith('/')).toBe(false)
    expect(url).toContain('plugins/com.sandeep.spreadsheet/grid.html')
  })
})

describe('PluginManager registration race (regression)', () => {
  // A real bug found via live QA (run-electron): registering the iframe
  // with PluginIPCBridge only in its `load` handler meant a plugin's
  // synchronous `plugin.activate()` — which posts its `register` messages
  // as soon as its script runs, not waiting for `load` — always lost that
  // first, load-bearing batch of messages, since the bridge silently drops
  // anything from a window it doesn't recognise yet. Registration must
  // happen the instant the iframe exists, before its document ever loads.
  it('registers the iframe with the IPC bridge before any load/message could arrive from it', async () => {
    const { installPluginIPCBridge } = await import('./PluginIPCBridge')
    const { useExtensionRegistry } = await import('../store/extensionRegistry')
    installPluginIPCBridge()

    setIPCAdapter({
      getInstalledPlugins: async () => [manifest()],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<PluginManager />)
    await waitFor(() => expect(iframes()).toHaveLength(1))

    const frame = iframes()[0]!
    const win = frame.contentWindow
    expect(win).not.toBeNull()

    // Simulate the plugin's registration script running immediately —
    // before any `load` event has had a chance to fire.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: 'flownote-plugin',
          type: 'register',
          extensionPoint: 'blockType',
          payload: { name: 'spreadsheet', label: 'Spreadsheet', renderPath: 'grid.html', defaultAttrs: {} },
        },
        source: win as unknown as Window,
      }),
    )

    expect(useExtensionRegistry.getState().blockTypes['com.sandeep.spreadsheet/spreadsheet']).toBeDefined()
  })
})
