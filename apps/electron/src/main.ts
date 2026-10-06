// Electron main process (Linux shell, DESIGN.md §3.2/§8.1).
// Starts the flownote-electron Rust sidecar under a crash-restart
// supervisor, wires it into an electron-trpc router, and opens a window
// whose preload script exposes that router to the renderer.
import { createIPCHandler } from 'electron-trpc/main'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appRouter, type Context } from './trpc/router'
import { SidecarSupervisor, type SupervisedProcess } from './sidecarSupervisor'

const isDev = !!process.env.VITE_DEV_SERVER_URL

// `flownote-plugin://` — DESIGN.md §9.1's sandboxed plugin iframes
// (`sandbox="allow-scripts"`, no `allow-same-origin`) get an opaque origin
// regardless of how their document is loaded (`src`, `srcdoc`, a `blob:`
// URL — tried all three live via `run-electron`), and Chromium refuses a
// `file://` subresource load from an opaque-origin document even for a
// sibling file in the same directory ("Not allowed to load local
// resource"). A privileged custom scheme sidesteps this the way DESIGN.md's
// own "served through a custom protocol handler" follow-up note anticipates
// — `registerSchemesAsPrivileged` must run before `app.whenReady()`, so
// it's here at module load, not inside `createWindow`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'flownote-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  // `flownote-attachment://<id>` — streams an attachment's bytes straight
  // from disk (EXECUTION_PLAN.md "Features" file-attachment entry) for an
  // embedded `<img>` or a file download, without round-tripping the bytes
  // through trpc/JSON. Same privilege set as `flownote-plugin` above, for
  // the same reason (a real `<img src>` load needs `supportFetchAPI`).
  { scheme: 'flownote-attachment', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

/**
 * Path to the compiled flownote-electron binary. electron-builder.yml's
 * `extraResources` copies the release binary to `resources/bin/` in a
 * packaged app; unpackaged (dev, or `electron-builder --dir`), it's read
 * straight out of the Cargo workspace's `target/` — see also
 * frontendIndexPath() below, which makes the same packaged/unpackaged split.
 */
function sidecarBinaryPath(): string {
  const name = process.platform === 'win32' ? 'flownote-electron.exe' : 'flownote-electron'
  if (app.isPackaged) return join(process.resourcesPath, 'bin', name)

  const profile = isDev ? 'debug' : 'release'
  // apps/electron/dist/main.js -> apps/electron -> apps -> repo root -> target/<profile>
  return join(__dirname, '..', '..', '..', 'target', profile, name)
}

/** Same packaged/unpackaged split as sidecarBinaryPath(), for the built frontend. */
function frontendIndexPath(): string {
  return join(frontendDistDir(), 'index.html')
}

/** The directory `frontendIndexPath()` lives in — also where `plugins/` and `sdk/` (Vite's copied-through `public/`) end up, so `flownote-plugin://` resolves against this same root. */
function frontendDistDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'frontend')
  // apps/electron/dist/main.js -> apps/electron -> apps -> repo root -> packages/frontend/dist
  return join(__dirname, '..', '..', '..', 'packages', 'frontend', 'dist')
}

function spawnSidecar(): SupervisedProcess {
  const child = spawn(sidecarBinaryPath(), [], {
    env: { ...process.env, FLOWNOTE_DB_PATH: join(app.getPath('userData'), 'flownote.sqlite3') },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // child_process's typings don't know stdio was requested as pipes, but we
  // just asked for exactly that above, so these are never null.
  return child as unknown as SupervisedProcess
}

function createWindow(sidecar: SidecarSupervisor): void {
  // Theme (light/dark/system) is renderer-owned and localStorage-persisted
  // (packages/frontend/src/store/themeStore.ts) — nativeTheme.themeSource
  // sync is deferred since no native chrome/dialogs exist yet on the
  // primary Linux shell to benefit from it.
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Electron's default sandboxed preload can only resolve Node/Electron
      // built-ins, not third-party packages — `preload.js`'s plain
      // `require('electron-trpc/main')` fails under it ("module not
      // found") since the preload is only `tsc`-compiled, not bundled.
      // `sandbox: false` runs the preload with normal Node module
      // resolution instead (contextIsolation stays on, so the renderer
      // still only gets what preload.ts explicitly puts on
      // `contextBridge`) — this is what electron-trpc's own examples do.
      sandbox: false,
    },
  })

  createIPCHandler<typeof appRouter>({
    router: appRouter,
    windows: [win],
    // `openPath` is injected rather than router.ts importing `electron`
    // itself, the same way `sidecar` is — keeps the trpc layer's only
    // dependency on real OS/process facilities at this one boundary.
    createContext: async (): Promise<Context> => ({ sidecar, openPath: shell.openPath }),
  })

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL as string)
  } else {
    win.loadFile(frontendIndexPath())
  }
}

/** `flownote-plugin:///plugins/<id>/<path>` / `flownote-plugin:///sdk/<path>` → a file under `frontendDistDir()`. Registered once `app` is ready, per Electron's `protocol.handle` API. */
function registerPluginProtocol(): void {
  protocol.handle('flownote-plugin', (request) => {
    const url = new URL(request.url)
    // `pluginAssetUrl()`/`sdkAssetUrl()` (PluginManager.tsx) build
    // `flownote-plugin:///plugins/<id>/<path>` — an empty-host, "authority
    // absent" URL, same shape as `file:///...`. But Chromium's URL parser
    // for a *custom* privileged "standard" scheme (unlike the built-in
    // `file:`) doesn't special-case an empty host the same way: it reads
    // whatever comes right after `//` as the host regardless, so
    // `flownote-plugin:///plugins/x` round-trips through `request.url` as
    // `flownote-plugin://plugins/x` — `url.host` is `"plugins"`, not `""`,
    // and `url.pathname` is missing that leading segment entirely. A real
    // bug caught live by `e2e-electron/plugin-lifecycle.spec.ts`: the
    // dropped segment 404'd, and the resulting rejected `net.fetch()`
    // promise (unhandled — `protocol.handle` doesn't catch a synchronously
    // *returned* rejection either) crashed the whole main process. Folding
    // `url.host` back onto the front of `url.pathname` recovers the
    // originally-intended path regardless of which way a given Chromium
    // version normalizes it.
    const pathname = url.host ? `/${url.host}${url.pathname}` : url.pathname
    return net.fetch(pathToFileURL(join(frontendDistDir(), pathname)).toString())
  })
}

/** `flownote-attachment://<id>` → the attachment's absolute path on disk, resolved via the sidecar's `get_attachment`. Registered once `sidecar` exists (unlike `registerPluginProtocol`, which needs nothing but the frontend dist dir), so this runs inside `app.whenReady()` after the sidecar is constructed rather than alongside it. */
function registerAttachmentProtocol(sidecar: SidecarSupervisor): void {
  protocol.handle('flownote-attachment', async (request) => {
    const url = new URL(request.url)
    // Same empty-host quirk `registerPluginProtocol` already documents for
    // this class of custom "standard" scheme — `url.host` carries the id
    // for `flownote-attachment://<id>`, not `url.pathname`.
    const id = url.host
    const attachment = (await sidecar.request('get_attachment', { id })) as { path: string }
    return net.fetch(pathToFileURL(attachment.path).toString())
  })
}

app.whenReady().then(() => {
  registerPluginProtocol()

  const sidecar = new SidecarSupervisor({
    spawn: spawnSidecar,
    crashLogPath: join(app.getPath('userData'), 'sidecar-crash.log'),
    onGiveUp: (lastExitCode) => {
      // TODO(DESIGN.md §10 "Rust sidecar crash on Linux"): surface an error
      // dialog to the user once the renderer/UI shell exists to host one.
      console.error(`flownote-electron sidecar exited (code ${lastExitCode}) and exhausted restarts`)
    },
  })
  sidecar.start()
  registerAttachmentProtocol(sidecar)

  createWindow(sidecar)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
