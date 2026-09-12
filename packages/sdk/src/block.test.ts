import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowNoteBlock } from './block'

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

describe('FlowNoteBlock', () => {
  it('calls onInit with the blockId and attrs once the host sends block:init', () => {
    const block = new FlowNoteBlock()
    const calls: [string, Record<string, unknown>][] = []
    block.onInit((id, attrs) => calls.push([id, attrs]))

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'flownote-host', type: 'block:init', blockId: 'block-1', attrs: { rows: 3 } } }),
    )
    expect(calls).toEqual([['block-1', { rows: 3 }]])
  })

  it('updateAttrs/reportHeight are no-ops before block:init arrives', () => {
    const block = new FlowNoteBlock()
    block.updateAttrs({ a: 1 })
    block.reportHeight(100)
    expect(posted).toHaveLength(0)
  })

  it('updateAttrs sends a block:update message once initialised', () => {
    const block = new FlowNoteBlock()
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'flownote-host', type: 'block:init', blockId: 'block-1', attrs: {} } }))

    block.updateAttrs({ data: { a1: 'hi' } })
    expect(posted).toEqual([{ source: 'flownote-plugin', type: 'block:update', blockId: 'block-1', attrs: { data: { a1: 'hi' } } }])
  })

  it('reportHeight sends a block:update message with height', () => {
    const block = new FlowNoteBlock()
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'flownote-host', type: 'block:init', blockId: 'block-1', attrs: {} } }))

    block.reportHeight(240)
    expect(posted).toEqual([{ source: 'flownote-plugin', type: 'block:update', blockId: 'block-1', height: 240 }])
  })
})
