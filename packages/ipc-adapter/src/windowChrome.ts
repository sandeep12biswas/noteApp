// How the desktop shell draws the window's title bar, so the frontend's
// TitleBar (packages/frontend/src/layout/TitleBar.tsx) knows what to render.
//
//   - 'overlay' (Electron): the native frame is hidden (`titleBarStyle:
//     'hidden'` in apps/electron/src/main.ts) but the OS still draws the
//     minimise/maximise/close buttons over the page's top-right corner — the
//     Window Controls Overlay. The bar only has to leave room for them.
//   - 'custom' (Tauri): the window has no decorations at all
//     (tauri.conf.json `decorations: false`), so the bar draws its own
//     buttons and calls these functions.
//   - 'none' (a plain browser, tests, or a shell that kept its native frame,
//     e.g. macOS): nothing to draw — the OS title bar is still there.
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface WindowControls {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
}

export type WindowChrome = { kind: 'none' } | { kind: 'overlay' } | { kind: 'custom'; controls: WindowControls }

interface OverlayNavigator {
  windowControlsOverlay?: { visible: boolean }
}

export async function resolveWindowChrome(): Promise<WindowChrome> {
  if (typeof window === 'undefined') return { kind: 'none' }
  if (window.__TAURI_INTERNALS__) {
    const win = getCurrentWindow()
    // Decorations stay on where the native bar is the better fit (macOS);
    // only a frameless window needs our buttons.
    if (await win.isDecorated()) return { kind: 'none' }
    return {
      kind: 'custom',
      controls: {
        minimize: () => win.minimize(),
        toggleMaximize: () => win.toggleMaximize(),
        close: () => win.close(),
      },
    }
  }
  if ((navigator as OverlayNavigator).windowControlsOverlay?.visible) return { kind: 'overlay' }
  return { kind: 'none' }
}
