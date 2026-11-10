// How the desktop shell draws the window's title bar, so the frontend's
// TitleBar (packages/frontend/src/layout/TitleBar.tsx) knows what to render.
//
//   - 'custom': the native frame is hidden (Electron on Linux:
//     `titleBarStyle: 'hidden'` in apps/electron/src/main.ts; Tauri:
//     tauri.conf.json `decorations: false`), so the bar draws the window
//     buttons itself — on the side and in the order the desktop uses
//     (`layout`; e.g. KDE/GNOME with close-minimise-maximise on the left).
//   - 'none' (a plain browser, tests, or a shell that kept its native frame,
//     e.g. macOS): nothing to draw — the OS title bar is still there.
import { getCurrentWindow } from '@tauri-apps/api/window'
import { electronWindowApi } from './electron'

export type WindowButton = 'minimize' | 'maximize' | 'close'

/** Buttons on each side of the title bar, in the order they appear from left to right. */
export interface ButtonLayout {
  left: WindowButton[]
  right: WindowButton[]
}

export interface WindowControls {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
}

export type WindowChrome = { kind: 'none' } | { kind: 'custom'; layout: ButtonLayout; controls: WindowControls }

/** Windows' (and most desktops') convention. */
export const DEFAULT_BUTTON_LAYOUT: ButtonLayout = { left: [], right: ['minimize', 'maximize', 'close'] }

export async function resolveWindowChrome(): Promise<WindowChrome> {
  if (typeof window === 'undefined') return { kind: 'none' }
  if (window.__TAURI_INTERNALS__) {
    const win = getCurrentWindow()
    // Decorations stay on where the native bar is the better fit (macOS);
    // only a frameless window needs our buttons.
    if (await win.isDecorated()) return { kind: 'none' }
    return {
      kind: 'custom',
      layout: DEFAULT_BUTTON_LAYOUT,
      controls: {
        minimize: () => win.minimize(),
        toggleMaximize: () => win.toggleMaximize(),
        close: () => win.close(),
      },
    }
  }
  if (window.electronTRPC) {
    const api = electronWindowApi()
    const info = await api.windowChrome.query()
    if (!info.frameless) return { kind: 'none' }
    return {
      kind: 'custom',
      layout: info.layout,
      controls: {
        minimize: () => api.windowMinimize.mutate(),
        toggleMaximize: () => api.windowToggleMaximize.mutate(),
        close: () => api.windowClose.mutate(),
      },
    }
  }
  return { kind: 'none' }
}
