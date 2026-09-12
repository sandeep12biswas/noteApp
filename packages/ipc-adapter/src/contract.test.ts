// Shared IPCAdapter contract suite — DESIGN.md §10 "IPCAdapter type drift"
// mitigation, applied from Phase 1 as EXECUTION_PLAN.md's cross-phase
// sequencing notes call for. Both ElectronIPCAdapter and TauriIPCAdapter run
// through the exact same assertions here; as each swaps its stub bodies for
// real IPC calls (backed by the same Rust flownote-core on both platforms),
// extend the per-method cases below rather than writing platform-specific
// tests elsewhere.
import { describe, expect, it } from 'vitest'
import { ElectronIPCAdapter } from './electron'
import { TauriIPCAdapter } from './tauri'
import type { IPCAdapter } from './types'

interface AdapterUnderTest {
  name: string
  create: () => IPCAdapter
}

const testSegment = {
  id: 'seg-1',
  pageId: 'page-1',
  x: 0,
  y: 0,
  w: 280,
  h: 40,
  zIndex: 0,
  borderColor: null,
  fillColor: null,
  content: { type: 'doc', content: [] },
}

const testFolder = { id: 'folder-1', name: 'Work', parentId: null, icon: null, expanded: false }

const adapters: AdapterUnderTest[] = [
  { name: 'ElectronIPCAdapter', create: () => new ElectronIPCAdapter() },
  { name: 'TauriIPCAdapter', create: () => new TauriIPCAdapter() },
]

describe.each(adapters)('$name (IPCAdapter contract)', ({ create }) => {
  it('getPage rejects rather than resolving or throwing synchronously', async () => {
    const adapter = create()
    await expect(adapter.getPage('page-1')).rejects.toThrow()
  })

  it('saveFolder rejects', async () => {
    const adapter = create()
    await expect(adapter.saveFolder(testFolder)).rejects.toThrow()
  })

  it('listFolders rejects', async () => {
    const adapter = create()
    await expect(adapter.listFolders()).rejects.toThrow()
  })

  it('savePage rejects', async () => {
    const adapter = create()
    await expect(adapter.savePage({ id: 'page-1', folderId: 'folder-1', title: 'Notes' })).rejects.toThrow()
  })

  it('listPages rejects', async () => {
    const adapter = create()
    await expect(adapter.listPages('folder-1')).rejects.toThrow()
  })

  it('listSegments rejects', async () => {
    const adapter = create()
    await expect(adapter.listSegments('page-1')).rejects.toThrow()
  })

  it('saveSegment rejects', async () => {
    const adapter = create()
    await expect(adapter.saveSegment(testSegment)).rejects.toThrow()
  })

  it('saveSegmentsBatch rejects', async () => {
    const adapter = create()
    await expect(adapter.saveSegmentsBatch([])).rejects.toThrow()
  })

  it('deleteSegment rejects', async () => {
    const adapter = create()
    await expect(adapter.deleteSegment('seg-1')).rejects.toThrow()
  })

  it('saveBlock rejects', async () => {
    const adapter = create()
    await expect(
      adapter.saveBlock({ id: 'block-1', segmentId: 'seg-1' }),
    ).rejects.toThrow()
  })

  it('saveInkLayer rejects', async () => {
    const adapter = create()
    await expect(adapter.saveInkLayer('page-1', 'data:image/png;base64,')).rejects.toThrow()
  })

  it('getInkLayer rejects', async () => {
    const adapter = create()
    await expect(adapter.getInkLayer('page-1')).rejects.toThrow()
  })

  it('addDictionaryWord rejects', async () => {
    const adapter = create()
    await expect(adapter.addDictionaryWord('foo')).rejects.toThrow()
  })

  it('listDictionaryWords rejects', async () => {
    const adapter = create()
    await expect(adapter.listDictionaryWords()).rejects.toThrow()
  })

  it('mergeSegments rejects', async () => {
    const adapter = create()
    await expect(adapter.mergeSegments('seg-1', 'seg-2')).rejects.toThrow()
  })

  it('search rejects', async () => {
    const adapter = create()
    await expect(adapter.search('query', 'notebook-1')).rejects.toThrow()
  })

  it('setPageMode rejects', async () => {
    const adapter = create()
    await expect(adapter.setPageMode('page-1', 'linear')).rejects.toThrow()
  })

  it('onSyncEvent throws synchronously rather than returning an inert unsubscribe', () => {
    const adapter = create()
    expect(() => adapter.onSyncEvent(() => {})).toThrow()
  })

  it('aiComplete rejects on first iteration without ever yielding a token', async () => {
    const adapter = create()
    const iterator = adapter.aiComplete('prompt', 'context')
    await expect(iterator.next()).rejects.toThrow()
  })

  it('installPlugin rejects', async () => {
    const adapter = create()
    await expect(adapter.installPlugin('/path/to/plugin')).rejects.toThrow()
  })

  it('uninstallPlugin rejects', async () => {
    const adapter = create()
    await expect(adapter.uninstallPlugin('com.example.plugin')).rejects.toThrow()
  })

  it('setPluginEnabled rejects', async () => {
    const adapter = create()
    await expect(adapter.setPluginEnabled('com.example.plugin', true)).rejects.toThrow()
  })

  it('getInstalledPlugins rejects', async () => {
    const adapter = create()
    await expect(adapter.getInstalledPlugins()).rejects.toThrow()
  })

  it('pluginStorageGet rejects', async () => {
    const adapter = create()
    await expect(adapter.pluginStorageGet('com.example.plugin', 'key')).rejects.toThrow()
  })

  it('pluginStorageSet rejects', async () => {
    const adapter = create()
    await expect(
      adapter.pluginStorageSet('com.example.plugin', 'key', 'value'),
    ).rejects.toThrow()
  })

  it('pluginStorageDelete rejects', async () => {
    const adapter = create()
    await expect(adapter.pluginStorageDelete('com.example.plugin', 'key')).rejects.toThrow()
  })

  it('pluginStorageList rejects', async () => {
    const adapter = create()
    await expect(adapter.pluginStorageList('com.example.plugin')).rejects.toThrow()
  })
})
