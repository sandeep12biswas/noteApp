// PluginManager — DESIGN.md §9.8. Loads every *enabled* installed plugin on
// mount (and whenever the enabled set changes) and creates one sandboxed
// "registration" iframe per plugin — that iframe loads the plugin's
// `entry` JS, which calls `plugin.activate()` (DESIGN.md §9.4) to send its
// `registerX()` calls to `PluginIPCBridge`. Renders nothing visible itself;
// registration iframes are `display: none` (they exist purely to run the
// plugin's top-level registration code, not to show UI — a plugin's actual
// UI is its own per-block-instance iframes, created separately wherever a
// block of that type is inserted).
import { useEffect } from 'react'
import type { PluginManifest } from '@flownote/ipc-adapter'
import { installPluginIPCBridge, registerPluginIframe, unregisterPluginIframe } from './PluginIPCBridge'
import { useExtensionRegistry } from '../store/extensionRegistry'
import { usePluginStore } from '../store/pluginStore'

/**
 * Every installed plugin's assets are served from this fixed root by id —
 * DESIGN.md's real install flow fetches/unzips a `.fnp` to a writable
 * directory; that's real follow-up work (Phase 7's `@flownote/cli`/registry
 * half, out of this session's "core plugin system" scope). For now, an
 * installed plugin's files are expected to already be sitting under
 * `public/plugins/<id>/` at build time (that's exactly where the reference
 * spreadsheet plugin's files live) — `install_plugin` only validates and
 * records the manifest, it doesn't move any files.
 *
 * The `flownote-plugin://` scheme (registered in `apps/electron/src/main.ts`,
 * mapped there to the same directory `public/` is copied into) is what
 * actually makes this loadable: found live via `run-electron` that a
 * sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) gets
 * an opaque origin no matter how its document is loaded (`src`, `srcdoc`,
 * `blob:` — tried all three), and Chromium refuses a `file://` subresource
 * load from an opaque-origin document even for a sibling file in the same
 * directory. A privileged custom scheme doesn't have that restriction.
 */
export function pluginAssetUrl(pluginId: string, relativePath: string): string {
  return `flownote-plugin:///plugins/${pluginId}/${relativePath}`
}

/** `@flownote/sdk`'s own `tsc` output, copied into `public/sdk/` (see `plugins/spreadsheet/README.md`) — same scheme as `pluginAssetUrl` for the same reason. */
function sdkAssetUrl(relativePath: string): string {
  return `flownote-plugin:///sdk/${relativePath}`
}

/** Wraps a plugin's `entry` JS in a minimal HTML document a sandboxed iframe can load — DESIGN.md's manifest `entry` is a JS file, not a page. */
function buildEntryDocumentHtml(entryAbsoluteUrl: string): string {
  // Compiled plain JS, not bundled — a plugin's source imports `@flownote/sdk`
  // by its package name like any other TS module; this import map is what
  // lets that bare specifier resolve inside a sandboxed iframe with no
  // bundler/dev-server of its own.
  const sdkUrl = sdkAssetUrl('index.js')
  return `<!doctype html><script type="importmap">{"imports":{"@flownote/sdk":"${sdkUrl}"}}</script><script type="module" src="${entryAbsoluteUrl}"></script>`
}

function PluginFrame({ manifest }: { manifest: PluginManifest }) {
  useEffect(() => {
    const iframe = document.createElement('iframe')
    // No `allow-same-origin` — DESIGN.md §9.1 "Sandboxed by default": this
    // is what actually prevents the plugin from ever reaching host DOM,
    // `localStorage`, or cookies, regardless of what its JS tries. Plain
    // `setAttribute` rather than the `.sandbox` `DOMTokenList` API — jsdom
    // (used by this file's own tests) doesn't implement the latter.
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.style.display = 'none'
    document.body.appendChild(iframe)

    // Registered *before* `srcdoc` is set, not in a `load` handler — found
    // live via `run-electron`: the plugin's registration script
    // (`plugin.activate()`) runs synchronously as the document loads and
    // `postMessage`s the host immediately, which can well be *before* a
    // `load` event fires. `PluginIPCBridge` was already listening (its one
    // global `message` handler is installed on `PluginManager` mount), but
    // it silently drops any message whose `event.source` isn't in the
    // iframe registry yet — so registering on `load` lost that first,
    // load-bearing batch of `register` messages every time. `contentWindow`
    // is available synchronously right after the iframe is in the DOM, and
    // stays the same `WindowProxy` across the `srcdoc` navigation that
    // follows, so registering here has no such race.
    const win = iframe.contentWindow
    if (win) {
      registerPluginIframe(win, {
        pluginId: manifest.id,
        permissions: new Set(manifest.permissions),
        extensionPoints: new Set(manifest.extensionPoints),
        kind: 'registration',
      })
    }
    // `srcdoc`, not a `blob:` URL — a `blob:` document gets its own opaque
    // origin, and Chromium refuses a `file://` subresource load ("Not
    // allowed to load local resource") from an opaque-origin document even
    // for a sibling file under the same directory (also found live). This
    // repo additionally serves plugin assets over a privileged
    // `flownote-plugin://` scheme (apps/electron/src/main.ts) since even
    // `srcdoc`'s inherited origin didn't help once the iframe's own
    // `sandbox` attribute forces it opaque anyway — `srcdoc` is kept
    // regardless, it's still simpler than managing a `blob:` URL's lifecycle.
    iframe.srcdoc = buildEntryDocumentHtml(pluginAssetUrl(manifest.id, manifest.entry))

    return () => {
      if (iframe.contentWindow) unregisterPluginIframe(iframe.contentWindow)
      iframe.remove()
      useExtensionRegistry.getState().unregisterPlugin(manifest.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-creating the iframe on every manifest object identity change (a fresh array from getInstalledPlugins each poll) would thrash it; id/entry/permissions changing at all is effectively a reinstall
  }, [manifest.id])

  return null
}

export function PluginManager() {
  const plugins = usePluginStore((s) => s.plugins)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)

  useEffect(() => {
    installPluginIPCBridge()
    // No sidecar / plugins table not reachable yet just means the list
    // stays empty — same "client-only state" fallback every other
    // IPCAdapter-backed feature already has.
    loadPlugins()
  }, [loadPlugins])

  return (
    <>
      {plugins.filter((p) => p.enabled).map((p) => (
        <PluginFrame key={p.id} manifest={p} />
      ))}
    </>
  )
}
