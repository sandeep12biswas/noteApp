// Builds URLs for the app's two custom schemes — `flownote-plugin` (plugin
// files + SDK) and `flownote-attachment` (attachment bytes by id). Each
// desktop shell serves them: apps/electron/src/main.ts and
// crates/flownote-tauri/src/protocols.rs.
//
// The URL shape depends on the webview:
//   - Electron, and Tauri on macOS/Linux:  `<scheme>://localhost/<path>`
//   - Tauri on Windows (WebView2 can't load a custom scheme directly, so
//     Tauri maps it onto a `.localhost` host): `http://<scheme>.localhost/<path>`
// Rather than sniff the OS, ask Tauri itself: its `convertFileSrc(path,
// scheme)` produces exactly that prefix. (It also percent-encodes the whole
// path, slashes included, which would break relative URLs inside a plugin's
// page — so only the prefix is taken from it and the path is appended as-is.)
//
// A fixed `localhost` host (instead of Electron's original empty-host
// `flownote-plugin:///…`) is what lets a plugin page use one root-relative
// URL that works on every platform — e.g. the spreadsheet's `/sdk/index.js`.

export type CustomScheme = 'flownote-plugin' | 'flownote-attachment'

interface TauriInternals {
  convertFileSrc?: (path: string, protocol: string) => string
}

export function customProtocolUrl(scheme: CustomScheme, path: string): string {
  const cleanPath = path.replace(/^\/+/, '')
  const tauri = (typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : undefined) as TauriInternals | undefined
  if (tauri?.convertFileSrc) {
    const prefix = tauri.convertFileSrc('', scheme) // e.g. "http://flownote-plugin.localhost/"
    return prefix.replace(/\/*$/, '/') + cleanPath
  }
  return `${scheme}://localhost/${cleanPath}`
}
