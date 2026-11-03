// PluginIPCBridge — DESIGN.md §9.8/§10 "Plugin sandbox escape" / "Plugin
// storage isolation failure". The core claim under test: a message's own
// `pluginId` (if it even tried to include one) is irrelevant — only
// `event.source` (which window sent it) decides which plugin a message is
// attributed to, and that mapping is entirely host-controlled via
// `registerPluginIframe`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPluginIframeRegistry,
  installPluginIPCBridge,
  registerPluginIframe,
  sendRibbonAction,
  uninstallPluginIPCBridge,
  unregisterPluginIframe,
} from './PluginIPCBridge'
import { useExtensionRegistry } from '../store/extensionRegistry'
import { setIPCAdapter } from '../store/notebookStore'

function fakeWindow(): Window {
  return { postMessage: vi.fn() } as unknown as Window
}

function dispatchFrom(source: Window, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

beforeEach(() => {
  useExtensionRegistry.setState({ blockTypes: {}, sectionTabs: {}, ribbonGroups: {}, slashCommands: {}, sidePanels: {} })
  clearPluginIframeRegistry()
  installPluginIPCBridge()
})

afterEach(() => {
  uninstallPluginIPCBridge()
  setIPCAdapter(null)
})

describe('register messages', () => {
  it('registers a declared blockType into ExtensionPointRegistry', () => {
    const win = fakeWindow()
    registerPluginIframe(win, {
      pluginId: 'com.sandeep.spreadsheet',
      permissions: new Set(),
      extensionPoints: new Set(['blockType:spreadsheet']),
      kind: 'registration',
    })

    dispatchFrom(win, {
      source: 'flownote-plugin',
      type: 'register',
      extensionPoint: 'blockType',
      payload: { name: 'spreadsheet', label: 'Spreadsheet', renderPath: 'grid.html', defaultAttrs: { rows: 5 } },
    })

    const entry = useExtensionRegistry.getState().blockTypes['com.sandeep.spreadsheet/spreadsheet']
    expect(entry).toMatchObject({ label: 'Spreadsheet', renderPath: 'grid.html', defaultAttrs: { rows: 5 } })
  })

  it('refuses to register an extension point the manifest never declared', () => {
    const win = fakeWindow()
    registerPluginIframe(win, {
      pluginId: 'com.sandeep.spreadsheet',
      permissions: new Set(),
      extensionPoints: new Set(['blockType:spreadsheet']), // does NOT declare "sneaky"
      kind: 'registration',
    })

    dispatchFrom(win, {
      source: 'flownote-plugin',
      type: 'register',
      extensionPoint: 'blockType',
      payload: { name: 'sneaky', label: 'Sneaky', renderPath: 'x.html', defaultAttrs: {} },
    })

    expect(useExtensionRegistry.getState().blockTypes['com.sandeep.spreadsheet/sneaky']).toBeUndefined()
  })

  it('ignores a message from a window the host never registered', () => {
    const stranger = fakeWindow()
    dispatchFrom(stranger, {
      source: 'flownote-plugin',
      type: 'register',
      extensionPoint: 'blockType',
      payload: { name: 'x', label: 'X', renderPath: 'x.html', defaultAttrs: {} },
    })
    expect(Object.keys(useExtensionRegistry.getState().blockTypes)).toHaveLength(0)
  })

  it("a message claiming a different pluginId in its payload is still attributed to the sending window's registered id", () => {
    const win = fakeWindow()
    registerPluginIframe(win, {
      pluginId: 'plugin-a',
      permissions: new Set(),
      extensionPoints: new Set(['blockType:x']),
      kind: 'registration',
    })

    // Even if this were somehow smuggled in, register's payload has no
    // pluginId field the bridge reads at all — it always uses `entry.pluginId`.
    dispatchFrom(win, {
      source: 'flownote-plugin',
      type: 'register',
      extensionPoint: 'blockType',
      payload: { name: 'x', label: 'X', renderPath: 'x.html', defaultAttrs: {}, pluginId: 'plugin-b' },
    })

    expect(useExtensionRegistry.getState().blockTypes['plugin-a/x']).toBeDefined()
    expect(useExtensionRegistry.getState().blockTypes['plugin-b/x']).toBeUndefined()
  })
})

describe('storage messages', () => {
  it('rejects a storage:set without storage:write permission', async () => {
    const win = fakeWindow()
    registerPluginIframe(win, { pluginId: 'plugin-a', permissions: new Set(['storage:read']), extensionPoints: new Set(), kind: 'registration' })
    setIPCAdapter({
      pluginStorageSet: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    dispatchFrom(win, { source: 'flownote-plugin', type: 'storage', requestId: 'r1', op: 'set', key: 'k', value: 'v' })
    await vi.waitFor(() => {
      expect(win.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'storage:response', requestId: 'r1', ok: false, error: expect.stringContaining('storage:write') }),
        '*',
      )
    })
  })

  it('forwards an authorised storage:get to the IPCAdapter and replies with the result', async () => {
    const win = fakeWindow()
    registerPluginIframe(win, { pluginId: 'plugin-a', permissions: new Set(['storage:read']), extensionPoints: new Set(), kind: 'registration' })
    setIPCAdapter({
      pluginStorageGet: vi.fn().mockResolvedValue('hello'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    dispatchFrom(win, { source: 'flownote-plugin', type: 'storage', requestId: 'r2', op: 'get', key: 'k' })
    await vi.waitFor(() => {
      expect(win.postMessage).toHaveBeenCalledWith(
        { source: 'flownote-host', type: 'storage:response', requestId: 'r2', ok: true, result: 'hello', error: undefined },
        '*',
      )
    })
  })

  it('one plugin cannot read another plugin storage — always calls the adapter with its own resolved pluginId, never a payload-supplied one', async () => {
    const winA = fakeWindow()
    registerPluginIframe(winA, { pluginId: 'plugin-a', permissions: new Set(['storage:read']), extensionPoints: new Set(), kind: 'registration' })
    const getSpy = vi.fn().mockResolvedValue('a-data')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setIPCAdapter({ pluginStorageGet: getSpy } as any)

    dispatchFrom(winA, { source: 'flownote-plugin', type: 'storage', requestId: 'r3', op: 'get', key: 'secret' })
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledWith('plugin-a', 'secret'))
  })

  it('replies with an error, not a throw, when no IPCAdapter is connected', async () => {
    const win = fakeWindow()
    registerPluginIframe(win, { pluginId: 'plugin-a', permissions: new Set(['storage:read']), extensionPoints: new Set(), kind: 'registration' })

    dispatchFrom(win, { source: 'flownote-plugin', type: 'storage', requestId: 'r4', op: 'get', key: 'k' })
    await vi.waitFor(() => {
      expect(win.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: expect.stringContaining('no backend') }),
        '*',
      )
    })
  })
})

describe('block:update messages', () => {
  it('routes to the registered onBlockUpdate callback for that block iframe only', () => {
    const winA = fakeWindow()
    const winB = fakeWindow()
    const receivedA: unknown[] = []
    const receivedB: unknown[] = []
    registerPluginIframe(winA, { pluginId: 'p', permissions: new Set(), extensionPoints: new Set(), kind: 'block', onBlockUpdate: (m) => receivedA.push(m) })
    registerPluginIframe(winB, { pluginId: 'p', permissions: new Set(), extensionPoints: new Set(), kind: 'block', onBlockUpdate: (m) => receivedB.push(m) })

    dispatchFrom(winA, { source: 'flownote-plugin', type: 'block:update', blockId: 'block-1', attrs: { a: 1 } })

    expect(receivedA).toEqual([{ attrs: { a: 1 }, height: undefined }])
    expect(receivedB).toHaveLength(0)
  })
})

describe('unregisterPluginIframe', () => {
  it('a message from a window that has since been unregistered is ignored', () => {
    const win = fakeWindow()
    registerPluginIframe(win, { pluginId: 'p', permissions: new Set(), extensionPoints: new Set(['blockType:x']), kind: 'registration' })
    unregisterPluginIframe(win)

    dispatchFrom(win, {
      source: 'flownote-plugin',
      type: 'register',
      extensionPoint: 'blockType',
      payload: { name: 'x', label: 'X', renderPath: 'x.html', defaultAttrs: {} },
    })
    expect(useExtensionRegistry.getState().blockTypes['p/x']).toBeUndefined()
  })
})

describe('sendRibbonAction', () => {
  it('posts a ribbon:action message to every registration iframe for that plugin', () => {
    const win = fakeWindow()
    registerPluginIframe(win, { pluginId: 'plugin-a', permissions: new Set(), extensionPoints: new Set(), kind: 'registration' })

    sendRibbonAction('plugin-a', 'group-1', 'button-1')

    expect(win.postMessage).toHaveBeenCalledWith({ source: 'flownote-host', type: 'ribbon:action', groupId: 'group-1', buttonId: 'button-1' }, '*')
  })

  it('does not post to a different plugin or to a block (non-registration) iframe', () => {
    const other = fakeWindow()
    const block = fakeWindow()
    registerPluginIframe(other, { pluginId: 'plugin-b', permissions: new Set(), extensionPoints: new Set(), kind: 'registration' })
    registerPluginIframe(block, { pluginId: 'plugin-a', permissions: new Set(), extensionPoints: new Set(), kind: 'block' })

    sendRibbonAction('plugin-a', 'group-1', 'button-1')

    expect(other.postMessage).not.toHaveBeenCalled()
    expect(block.postMessage).not.toHaveBeenCalled()
  })
})
