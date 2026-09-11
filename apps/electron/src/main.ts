// Electron main process (Linux shell, DESIGN.md §3.2/§8.1).
// Starts the flownote-electron Rust sidecar under a crash-restart
// supervisor, wires it into an electron-trpc router, and opens a window
// whose preload script exposes that router to the renderer.
import { createIPCHandler } from 'electron-trpc/main'
import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { appRouter, type Context } from './trpc/router'
import { SidecarSupervisor, type SupervisedProcess } from './sidecarSupervisor'

const isDev = !!process.env.VITE_DEV_SERVER_URL

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
  if (app.isPackaged) return join(process.resourcesPath, 'frontend', 'index.html')
  // apps/electron/dist/main.js -> apps/electron -> apps -> repo root -> packages/frontend/dist
  return join(__dirname, '..', '..', '..', 'packages', 'frontend', 'dist', 'index.html')
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
    createContext: async (): Promise<Context> => ({ sidecar }),
  })

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL as string)
  } else {
    win.loadFile(frontendIndexPath())
  }
}

app.whenReady().then(() => {
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

  createWindow(sidecar)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
