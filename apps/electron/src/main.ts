// Electron main process (Linux shell, DESIGN.md §3.2/§8.1).
// Phase 1 exit criterion: opens a blank window backed by a stubbed IPCAdapter.
// TODO: start the flownote-electron Rust sidecar and wire electron-trpc's
// createIPCHandler + a preload bridge once the sidecar and trpc router exist.
import { app, BrowserWindow } from 'electron'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: undefined, // TODO: preload bridge exposing window.electronIPC
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile('../../packages/frontend/dist/index.html')
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
