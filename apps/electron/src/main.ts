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

/** Path to the compiled flownote-electron binary, built by `cargo build`. */
function sidecarBinaryPath(): string {
  const profile = isDev ? 'debug' : 'release'
  const name = process.platform === 'win32' ? 'flownote-electron.exe' : 'flownote-electron'
  // apps/electron/dist/main.js (or src/main.ts under tsx) -> repo root -> target/<profile>
  return join(__dirname, '..', '..', '..', 'target', profile, name)
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
    win.loadFile(join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'))
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
