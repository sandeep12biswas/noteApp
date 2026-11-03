// The per-instance side of `registerBlockType` (DESIGN.md §9.4's `render`
// spec) — a *separate* sandboxed iframe from the plugin's registration one,
// one per block inserted into a note. `FlowNoteBlock` is this iframe's
// entry point: it receives its `blockId`/initial `attrs` once from the host
// (`block:init`), and reports attrs/height changes back
// (`block:update`) — e.g. the spreadsheet reference plugin's `grid.html`.
import { type HostToPluginMessage, isHostToPluginMessage } from './protocol.js'
import { PluginStorage } from './index.js'

export class FlowNoteBlock {
  readonly storage: PluginStorage
  #blockId: string | null = null
  #onInit: ((blockId: string, attrs: Record<string, unknown>) => void) | null = null

  constructor() {
    this.storage = new PluginStorage((msg) => window.parent.postMessage(msg, '*'))
    window.addEventListener('message', (e: MessageEvent) => {
      const data: HostToPluginMessage | unknown = e.data
      if (!isHostToPluginMessage(data) || data.type !== 'block:init') return
      this.#blockId = data.blockId
      this.#onInit?.(data.blockId, data.attrs)
    })
  }

  /** Called once the host has sent this block's id and initial attrs. */
  onInit(handler: (blockId: string, attrs: Record<string, unknown>) => void): void {
    this.#onInit = handler
  }

  updateAttrs(attrs: Record<string, unknown>): void {
    if (!this.#blockId) return
    window.parent.postMessage({ source: 'flownote-plugin', type: 'block:update', blockId: this.#blockId, attrs }, '*')
  }

  reportHeight(height: number): void {
    if (!this.#blockId) return
    window.parent.postMessage({ source: 'flownote-plugin', type: 'block:update', blockId: this.#blockId, height }, '*')
  }
}
