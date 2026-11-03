// @flownote/sdk — plugin developers import this, declare extension points,
// call `plugin.activate()`; every `registerX()` here just queues a message
// sent to the host on `activate()` (DESIGN.md §9.4). Runs inside a
// `sandbox="allow-scripts"` iframe with no `allow-same-origin` — no DOM
// access to the host, no `localStorage` — so everything here talks to the
// host purely via `postMessage`, never anything else.
import {
  type ExtensionPointKind,
  type HostToPluginMessage,
  type RegisterPayloadFor,
  isHostToPluginMessage,
} from './protocol.js'

export * from './protocol.js'
export { FlowNoteBlock } from './block.js'

interface QueuedRegistration {
  extensionPoint: ExtensionPointKind
  payload: unknown
}

let nextRequestId = 1

/** `plugin.storage` — isolated key/value storage backed by the host's `plugin_storage` table (DESIGN.md §9.2 `registerStorageNamespace`). */
export class PluginStorage {
  #send: (msg: unknown) => void

  constructor(send: (msg: unknown) => void) {
    this.#send = send
  }

  async get(key: string): Promise<string | null> {
    const result = await this.#request('get', key)
    return typeof result === 'string' ? result : null
  }

  async set(key: string, value: string): Promise<void> {
    await this.#request('set', key, value)
  }

  async delete(key: string): Promise<void> {
    await this.#request('delete', key)
  }

  async list(): Promise<string[]> {
    const result = await this.#request('list')
    return Array.isArray(result) ? result : []
  }

  #request(op: 'get' | 'set' | 'delete' | 'list', key?: string, value?: string): Promise<string | string[] | null> {
    const requestId = `req-${nextRequestId++}`
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        if (!isHostToPluginMessage(e.data) || e.data.type !== 'storage:response' || e.data.requestId !== requestId) return
        window.removeEventListener('message', onMessage)
        if (e.data.ok) resolve(e.data.result ?? null)
        else reject(new Error(e.data.error ?? `plugin storage ${op} failed`))
      }
      window.addEventListener('message', onMessage)
      this.#send({ source: 'flownote-plugin', type: 'storage', requestId, op, key, value })
    })
  }
}

export interface BlockTypeSpec {
  name: string
  label: string
  slashCommand?: string
  /** Relative path, resolved via `plugin.resolveAsset()` — the host loads this in a per-block-instance sandboxed iframe. */
  render: string
  defaultAttrs?: Record<string, unknown>
}

export interface RibbonButtonSpec {
  id: string
  label: string
}

export interface RibbonGroupSpec {
  id: string
  ribbonTab: 'Home' | 'Insert' | 'Draw' | 'View'
  label: string
  buttons: RibbonButtonSpec[]
  /** Called when any of this group's buttons is clicked — dispatched by button id, not a per-button closure (closures can't cross `postMessage`, DESIGN.md §9.8). */
  onAction?: (buttonId: string) => void
}

export interface SlashCommandSpec {
  id: string
  label: string
  /** The `BlockTypeSpec.name` this command inserts. */
  blockType: string
}

export interface SectionTabSpec {
  id: string
  label: string
}

export interface SidePanelSpec {
  id: string
  label: string
}

/**
 * The plugin's one entry point. Construct one, call its `registerX()`
 * methods to declare what it contributes, then `activate()` once — that's
 * when every queued registration actually reaches the host (DESIGN.md
 * §9.4's example does exactly this ordering).
 */
export class FlowNotePlugin {
  #queue: QueuedRegistration[] = []
  #ribbonActionHandlers = new Map<string, (buttonId: string) => void>()
  #activated = false
  readonly storage: PluginStorage

  constructor() {
    this.storage = new PluginStorage((msg) => window.parent.postMessage(msg, '*'))
    window.addEventListener('message', (e: MessageEvent) => {
      const data: HostToPluginMessage | unknown = e.data
      if (!isHostToPluginMessage(data) || data.type !== 'ribbon:action') return
      this.#ribbonActionHandlers.get(data.groupId)?.(data.buttonId)
    })
  }

  registerBlockType(spec: BlockTypeSpec): void {
    this.#enqueue('blockType', {
      name: spec.name,
      label: spec.label,
      slashCommand: spec.slashCommand,
      renderPath: spec.render,
      defaultAttrs: spec.defaultAttrs ?? {},
    })
    if (spec.slashCommand) {
      this.#enqueue('slashCommand', { id: spec.slashCommand, label: spec.label, blockType: spec.name })
    }
  }

  registerSectionTab(spec: SectionTabSpec): void {
    this.#enqueue('sectionTab', spec)
  }

  registerRibbonGroup(spec: RibbonGroupSpec): void {
    if (spec.onAction) this.#ribbonActionHandlers.set(spec.id, spec.onAction)
    this.#enqueue('ribbonGroup', { id: spec.id, ribbonTab: spec.ribbonTab, label: spec.label, buttons: spec.buttons })
  }

  registerSlashCommand(spec: SlashCommandSpec): void {
    this.#enqueue('slashCommand', spec)
  }

  registerSidePanel(spec: SidePanelSpec): void {
    this.#enqueue('sidePanel', spec)
  }

  registerStorageNamespace(): void {
    this.#enqueue('storageNamespace', { declared: true })
  }

  /** Resolves a plugin-relative asset path to a URL the host's block-instance iframes can load. Relative to this iframe's own location — the host serves every installed plugin's assets from its own root. */
  resolveAsset(path: string): string {
    return new URL(path, window.location.href).toString()
  }

  /** Sends every queued `registerX()` call to the host. Call once, after all registrations. */
  activate(): void {
    if (this.#activated) return
    this.#activated = true
    for (const { extensionPoint, payload } of this.#queue) {
      window.parent.postMessage({ source: 'flownote-plugin', type: 'register', extensionPoint, payload }, '*')
    }
  }

  #enqueue<K extends ExtensionPointKind>(extensionPoint: K, payload: RegisterPayloadFor<K>): void {
    this.#queue.push({ extensionPoint, payload })
  }
}
