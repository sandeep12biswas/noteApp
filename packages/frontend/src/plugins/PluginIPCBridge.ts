// PluginIPCBridge — DESIGN.md §9.8. The one `message` listener that ever
// talks to a plugin's sandboxed iframes: `PluginManager` registers each
// iframe it creates here (by `contentWindow` reference, with the plugin's
// id and declared permissions/extensionPoints resolved at registration
// time — see `registerIframe`), and every inbound message is looked up by
// `event.source` against that registry. A message's own payload is never
// trusted for identity (`pluginId`) — DESIGN.md §10 "Plugin storage
// isolation failure"/"Plugin sandbox escape" both hinge on this: a
// malicious plugin claiming to be a different `pluginId` inside its message
// body has no effect, because the bridge already knows who's talking from
// *which window object* sent the event, something only the host (which
// created that iframe) can spoof — the plugin's own JS never gets a
// reference to a different plugin's iframe to impersonate it from (no
// `allow-same-origin`, no host DOM access).
import {
  type BlockUpdateMessage,
  type ExtensionPointKind,
  type PluginToHostMessage,
  type RegisterBlockTypePayload,
  type RegisterRibbonGroupPayload,
  type RegisterSectionTabPayload,
  type RegisterSidePanelPayload,
  type RegisterSlashCommandPayload,
  isPluginToHostMessage,
} from '@flownote/sdk'
import { useExtensionRegistry } from '../store/extensionRegistry'
import { getIPCAdapter } from '../store/notebookStore'

export type IframeKind = 'registration' | 'block'

export interface PluginIframeEntry {
  pluginId: string
  permissions: Set<string>
  /** From the manifest's `extensionPoints` (DESIGN.md §9.3) — a `register` call for anything not declared here is refused. */
  extensionPoints: Set<string>
  kind: IframeKind
  /** Only for `kind: 'block'` — routes a `block:update` message to that block instance's own NodeView, without the bridge needing to know anything about TipTap. */
  onBlockUpdate?: (msg: Pick<BlockUpdateMessage, 'attrs' | 'height'>) => void
}

const iframeRegistry = new Map<Window, PluginIframeEntry>()
let listenerInstalled = false

/** Called by `PluginManager` right after creating an iframe (registration or per-block). */
export function registerPluginIframe(win: Window, entry: PluginIframeEntry): void {
  iframeRegistry.set(win, entry)
}

/** Called when an iframe is destroyed (plugin disabled/uninstalled, or a block removed from the document). */
export function unregisterPluginIframe(win: Window): void {
  iframeRegistry.delete(win)
}

/** Test-only: drops every registered iframe without touching the listener. */
export function clearPluginIframeRegistry(): void {
  iframeRegistry.clear()
}

function hasDeclaredExtensionPoint(entry: PluginIframeEntry, kind: ExtensionPointKind, id: string): boolean {
  return entry.extensionPoints.has(`${kind}:${id}`)
}

function registrationId(extensionPoint: ExtensionPointKind, payload: unknown): string | null {
  switch (extensionPoint) {
    case 'blockType':
      return (payload as RegisterBlockTypePayload).name
    case 'sectionTab':
      return (payload as RegisterSectionTabPayload).id
    case 'ribbonGroup':
      return (payload as RegisterRibbonGroupPayload).id
    case 'slashCommand':
      return (payload as RegisterSlashCommandPayload).id
    case 'sidePanel':
      return (payload as RegisterSidePanelPayload).id
    case 'storageNamespace':
      return null
    default:
      return null
  }
}

function handleRegister(entry: PluginIframeEntry, extensionPoint: ExtensionPointKind, payload: unknown): void {
  // `storageNamespace` is manifest-visible metadata, not a real
  // registration — declaring it just requires the plugin manifest listed
  // it, no separate id check.
  if (extensionPoint !== 'storageNamespace') {
    const id = registrationId(extensionPoint, payload)
    if (id === null || !hasDeclaredExtensionPoint(entry, extensionPoint, id)) return
  }

  const registry = useExtensionRegistry.getState()
  const pluginId = entry.pluginId

  switch (extensionPoint) {
    case 'blockType': {
      const p = payload as RegisterBlockTypePayload
      registry.registerBlockType({ pluginId, id: p.name, label: p.label, renderPath: p.renderPath, defaultAttrs: p.defaultAttrs })
      break
    }
    case 'sectionTab': {
      const p = payload as RegisterSectionTabPayload
      registry.registerSectionTab({ pluginId, id: p.id, label: p.label })
      break
    }
    case 'ribbonGroup': {
      const p = payload as RegisterRibbonGroupPayload
      registry.registerRibbonGroup({ pluginId, id: p.id, ribbonTab: p.ribbonTab, label: p.label, buttons: p.buttons })
      break
    }
    case 'slashCommand': {
      const p = payload as RegisterSlashCommandPayload
      registry.registerSlashCommand({ pluginId, id: p.id, label: p.label, blockType: p.blockType })
      break
    }
    case 'sidePanel': {
      const p = payload as RegisterSidePanelPayload
      registry.registerSidePanel({ pluginId, id: p.id, label: p.label })
      break
    }
    case 'storageNamespace':
      break
  }
}

async function handleStorage(entry: PluginIframeEntry, msg: Extract<PluginToHostMessage, { type: 'storage' }>, source: Window): Promise<void> {
  const ipc = getIPCAdapter()
  const reply = (ok: boolean, result?: string | string[] | null, error?: string) => {
    source.postMessage({ source: 'flownote-host', type: 'storage:response', requestId: msg.requestId, ok, result, error }, '*')
  }

  const needsRead = msg.op === 'get' || msg.op === 'list'
  const needsWrite = msg.op === 'set' || msg.op === 'delete'
  if (needsRead && !entry.permissions.has('storage:read')) return reply(false, null, 'missing permission: storage:read')
  if (needsWrite && !entry.permissions.has('storage:write')) return reply(false, null, 'missing permission: storage:write')
  if (!ipc) return reply(false, null, 'no backend connected')

  try {
    switch (msg.op) {
      case 'get':
        return reply(true, await ipc.pluginStorageGet(entry.pluginId, msg.key!))
      case 'set':
        await ipc.pluginStorageSet(entry.pluginId, msg.key!, msg.value!)
        return reply(true)
      case 'delete':
        await ipc.pluginStorageDelete(entry.pluginId, msg.key!)
        return reply(true)
      case 'list':
        return reply(true, await ipc.pluginStorageList(entry.pluginId))
    }
  } catch (err) {
    reply(false, null, err instanceof Error ? err.message : String(err))
  }
}

function onMessage(e: MessageEvent): void {
  const entry = iframeRegistry.get(e.source as Window)
  if (!entry) return
  if (!isPluginToHostMessage(e.data)) return

  switch (e.data.type) {
    case 'register':
      handleRegister(entry, e.data.extensionPoint, e.data.payload)
      break
    case 'storage':
      void handleStorage(entry, e.data, e.source as Window)
      break
    case 'block:update':
      entry.onBlockUpdate?.({ attrs: e.data.attrs, height: e.data.height })
      break
  }
}

/** Installs the one `message` listener — idempotent, safe to call from every `PluginManager` mount. */
export function installPluginIPCBridge(): void {
  if (listenerInstalled) return
  listenerInstalled = true
  window.addEventListener('message', onMessage)
}

/** Test-only. */
export function uninstallPluginIPCBridge(): void {
  listenerInstalled = false
  window.removeEventListener('message', onMessage)
}

/** Sends a ribbon button click to the plugin's registration iframe (DESIGN.md §9.8 — buttons dispatch by id, not a transmitted closure). */
export function sendRibbonAction(pluginId: string, groupId: string, buttonId: string): void {
  for (const [win, entry] of iframeRegistry) {
    if (entry.pluginId === pluginId && entry.kind === 'registration') {
      win.postMessage({ source: 'flownote-host', type: 'ribbon:action', groupId, buttonId }, '*')
    }
  }
}
