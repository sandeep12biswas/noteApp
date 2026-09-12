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
export const EXTENSION_POINTS = ['blockType', 'sectionTab', 'ribbonGroup', 'slashCommand', 'sidePanel', 'storageNamespace'];
export function isPluginToHostMessage(data) {
    return typeof data === 'object' && data !== null && data.source === 'flownote-plugin';
}
export function isHostToPluginMessage(data) {
    return typeof data === 'object' && data !== null && data.source === 'flownote-host';
}
