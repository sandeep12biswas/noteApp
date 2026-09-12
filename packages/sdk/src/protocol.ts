// The `postMessage` wire protocol between a plugin's sandboxed iframe(s) and
// the host's `PluginIPCBridge` (packages/frontend/src/plugins/PluginIPCBridge.ts)
// — DESIGN.md §9.8. Shared by both sides (this SDK, imported by plugin code,
// and the host bridge, which imports this package too) so the message shape
// can't drift between them the way two hand-duplicated definitions would.
//
// Two kinds of iframe send these: a plugin's one "registration" iframe
// (loads the plugin's `entry`, calls `plugin.activate()`) and, per active
// `registerBlockType` instance, a separate "block" iframe rendering that
// block's own UI. Both are validated the same way host-side: `pluginId` is
// resolved from *which iframe* sent the message (`event.source` matched
// against a registry the host itself populated when it created that
// iframe), never trusted from a field inside the message payload — DESIGN.md
// §10 "Plugin storage isolation failure"/"Plugin sandbox escape".

export const EXTENSION_POINTS = ['blockType', 'sectionTab', 'ribbonGroup', 'slashCommand', 'sidePanel', 'storageNamespace'] as const
export type ExtensionPointKind = (typeof EXTENSION_POINTS)[number]

export interface RegisterBlockTypePayload {
  name: string
  label: string
  slashCommand?: string
  /** Resolved via `plugin.resolveAsset()` — a path served under this plugin's own asset root, never an arbitrary URL. */
  renderPath: string
  defaultAttrs: Record<string, unknown>
}

export interface RegisterSectionTabPayload {
  id: string
  label: string
}

export interface RegisterRibbonGroupPayload {
  id: string
  ribbonTab: 'Home' | 'Insert' | 'Draw' | 'View'
  label: string
  buttons: { id: string; label: string }[]
}

export interface RegisterSlashCommandPayload {
  id: string
  label: string
  /** Matches a `blockType`'s `name` this command inserts. */
  blockType: string
}

export interface RegisterSidePanelPayload {
  id: string
  label: string
}

export interface RegisterStorageNamespacePayload {
  // Storage is namespaced by `pluginId` automatically (resolved from iframe
  // identity, same as everything else) — declaring this extension point is
  // just a manifest-visible signal "this plugin persists data," not a
  // configuration.
  declared: true
}

export type RegisterPayloadFor<K extends ExtensionPointKind> = K extends 'blockType'
  ? RegisterBlockTypePayload
  : K extends 'sectionTab'
    ? RegisterSectionTabPayload
    : K extends 'ribbonGroup'
      ? RegisterRibbonGroupPayload
      : K extends 'slashCommand'
        ? RegisterSlashCommandPayload
        : K extends 'sidePanel'
          ? RegisterSidePanelPayload
          : RegisterStorageNamespacePayload

/** Plugin iframe → host: register an extension point (DESIGN.md §9.2). */
export interface RegisterMessage {
  source: 'flownote-plugin'
  type: 'register'
  extensionPoint: ExtensionPointKind
  payload: unknown
}

export type StorageOp = 'get' | 'set' | 'delete' | 'list'

/** Plugin iframe → host: a `plugin.storage.*` call. */
export interface StorageRequestMessage {
  source: 'flownote-plugin'
  type: 'storage'
  requestId: string
  op: StorageOp
  key?: string
  value?: string
}

/** Block iframe → host: the block instance's attrs or rendered height changed. */
export interface BlockUpdateMessage {
  source: 'flownote-plugin'
  type: 'block:update'
  blockId: string
  attrs?: Record<string, unknown>
  height?: number
}

export type PluginToHostMessage = RegisterMessage | StorageRequestMessage | BlockUpdateMessage

/** Host → plugin iframe: reply to a `StorageRequestMessage`. */
export interface StorageResponseMessage {
  source: 'flownote-host'
  type: 'storage:response'
  requestId: string
  ok: boolean
  result?: string | string[] | null
  error?: string
}

/** Host → registration iframe: a ribbon button the plugin registered was clicked. */
export interface RibbonActionMessage {
  source: 'flownote-host'
  type: 'ribbon:action'
  groupId: string
  buttonId: string
}

/** Host → block iframe: this block instance's id and current attrs, sent once on load. */
export interface BlockInitMessage {
  source: 'flownote-host'
  type: 'block:init'
  blockId: string
  attrs: Record<string, unknown>
}

export type HostToPluginMessage = StorageResponseMessage | RibbonActionMessage | BlockInitMessage

export function isPluginToHostMessage(data: unknown): data is PluginToHostMessage {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === 'flownote-plugin'
}

export function isHostToPluginMessage(data: unknown): data is HostToPluginMessage {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === 'flownote-host'
}
