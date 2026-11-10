// The lavender title bar (issue #40). Both desktop shells hide the native
// frame, so this bar is what the user drags the window by and where the
// app name and current page show. What it has to draw depends on the shell
// (see @flownote/ipc-adapter's resolveWindowChrome):
//   - Electron: the OS draws the window buttons over the top-right corner;
//     the bar leaves room for them using the Window Controls Overlay
//     `titlebar-area-*` CSS environment variables.
//   - Tauri: frameless, so the bar draws its own minimise/maximise/close.
//   - Browser / native frame kept: renders nothing.
import { useEffect, useState } from 'react'
import { resolveWindowChrome, type WindowChrome } from '@flownote/ipc-adapter'
import iconUrl from '../assets/flownote-icon.svg'
import { useNotebookStore } from '../store/notebookStore'

/** Must equal TITLE_BAR_OVERLAY.height in apps/electron/src/main.ts. */
export const TITLE_BAR_HEIGHT = 36

export function TitleBar({ chrome: chromeProp }: { chrome?: WindowChrome } = {}) {
  const [chrome, setChrome] = useState<WindowChrome>(chromeProp ?? { kind: 'none' })
  const pageName = useNotebookStore((s) => (s.selectedFileId ? s.files[s.selectedFileId]?.name : undefined))
  const title = pageName ? `${pageName} — FlowNote` : 'FlowNote'

  useEffect(() => {
    if (chromeProp) return
    let live = true
    resolveWindowChrome()
      .then((c) => live && setChrome(c))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [chromeProp])

  // The taskbar / window switcher shows document.title, with or without the bar.
  useEffect(() => {
    document.title = title
  }, [title])

  if (chrome.kind === 'none') return null

  const BTN = 'flex h-full w-11 items-center justify-center text-white/90 hover:bg-white/15'
  return (
    <div
      className="flownote-titlebar flex shrink-0 select-none items-center gap-2 pl-3 text-white"
      style={{
        height: TITLE_BAR_HEIGHT,
        // Leave room for Electron's overlaid window buttons on the right.
        paddingRight: chrome.kind === 'overlay' ? 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))' : 0,
      }}
      data-tauri-drag-region=""
      data-testid="title-bar"
      onDoubleClick={chrome.kind === 'custom' ? () => void chrome.controls.toggleMaximize() : undefined}
    >
      <img src={iconUrl} alt="" className="pointer-events-none h-5 w-5" />
      <span className="pointer-events-none flex-1 truncate text-[13px] font-semibold tracking-wide">{title}</span>
      {chrome.kind === 'custom' && (
        <div className="flex h-full">
          <button type="button" className={BTN} aria-label="Minimise" onClick={() => void chrome.controls.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" /></svg>
          </button>
          <button type="button" className={BTN} aria-label="Maximise" onClick={() => void chrome.controls.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
          </button>
          <button type="button" className={BTN + ' hover:!bg-red-600'} aria-label="Close" onClick={() => void chrome.controls.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
