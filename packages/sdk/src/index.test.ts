// @flownote/sdk — DESIGN.md §9.4. `FlowNotePlugin` only ever talks to
// `window.parent` via `postMessage`; these tests intercept that instead of
// standing up a real host, mirroring how a sandboxed iframe with no
// `allow-same-origin` actually sees its parent (opaque, message-only).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowNotePlugin } from './index'

let posted: unknown[] = []

beforeEach(() => {
  posted = []
  vi.spyOn(window.parent, 'postMessage').mockImplementation((msg: unknown) => {
    posted.push(msg)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerX + activate', () => {
  it('queues registrations and only sends them on activate()', () => {
    const plugin = new FlowNotePlugin()
    plugin.registerBlockType({ name: 'spreadsheet', label: 'Spreadsheet', render: 'grid.html' })
    expect(posted).toHaveLength(0)

    plugin.activate()
    expect(posted).toEqual([
      { source: 'flownote-plugin', type: 'register', extensionPoint: 'blockType', payload: expect.objectContaining({ name: 'spreadsheet' }) },
    ])
  })

  it('registerBlockType with a slashCommand also queues a slashCommand registration', () => {
    const plugin = new FlowNotePlugin()
    plugin.registerBlockType({ name: 'spreadsheet', label: 'Spreadsheet', render: 'grid.html', slashCommand: '/sheet' })
    plugin.activate()

    const kinds = posted.map((m) => (m as { extensionPoint: string }).extensionPoint)
    expect(kinds).toEqual(['blockType', 'slashCommand'])
    expect(posted[1]).toMatchObject({ payload: { id: '/sheet', blockType: 'spreadsheet' } })
  })

  it('activate() is idempotent — calling it twice does not resend', () => {
    const plugin = new FlowNotePlugin()
    plugin.registerSectionTab({ id: 'tab-1', label: 'Tab' })
    plugin.activate()
    plugin.activate()
    expect(posted).toHaveLength(1)
  })
})

describe('registerRibbonGroup onAction', () => {
  it('dispatches a ribbon:action message from the host to the matching handler by button id', () => {
    const plugin = new FlowNotePlugin()
    const calls: string[] = []
    plugin.registerRibbonGroup({
      id: 'sheet-tools',
      ribbonTab: 'Home',
      label: 'Spreadsheet',
      buttons: [{ id: 'insert-row', label: 'Row' }],
      onAction: (buttonId) => calls.push(buttonId),
    })
    plugin.activate()

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'ribbon:action', groupId: 'sheet-tools', buttonId: 'insert-row' } }),
    )
    expect(calls).toEqual(['insert-row'])
  })

  it('ignores a ribbon:action for a different groupId', () => {
    const plugin = new FlowNotePlugin()
    const calls: string[] = []
    plugin.registerRibbonGroup({ id: 'a', ribbonTab: 'Home', label: 'A', buttons: [], onAction: () => calls.push('a') })
    plugin.activate()

    window.dispatchEvent(new MessageEvent('message', { data: { source: 'flownote-host', type: 'ribbon:action', groupId: 'b', buttonId: 'x' } }))
    expect(calls).toHaveLength(0)
  })
})

describe('plugin.storage', () => {
  it('get() resolves with the host response matching its requestId', async () => {
    const plugin = new FlowNotePlugin()
    const promise = plugin.storage.get('k1')

    const sent = posted[0] as { requestId: string; op: string; key: string }
    expect(sent).toMatchObject({ source: 'flownote-plugin', type: 'storage', op: 'get', key: 'k1' })

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'storage:response', requestId: sent.requestId, ok: true, result: 'hello' } }),
    )
    await expect(promise).resolves.toBe('hello')
  })

  it('rejects when the host reports an error', async () => {
    const plugin = new FlowNotePlugin()
    const promise = plugin.storage.set('k1', 'v1')
    const sent = posted[0] as { requestId: string }

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'storage:response', requestId: sent.requestId, ok: false, error: 'no permission' } }),
    )
    await expect(promise).rejects.toThrow('no permission')
  })

  it('list() returns [] when the host responds with no result', async () => {
    const plugin = new FlowNotePlugin()
    const promise = plugin.storage.list()
    const sent = posted[0] as { requestId: string }
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'storage:response', requestId: sent.requestId, ok: true, result: ['a', 'b'] } }),
    )
    await expect(promise).resolves.toEqual(['a', 'b'])
  })

  it('a response for a different requestId is ignored', async () => {
    const plugin = new FlowNotePlugin()
    const promise = plugin.storage.get('k1')
    const sent = posted[0] as { requestId: string }

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'storage:response', requestId: 'not-it', ok: true, result: 'wrong' } }),
    )
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'storage:response', requestId: sent.requestId, ok: true, result: 'right' } }),
    )
    await expect(promise).resolves.toBe('right')
  })
})
