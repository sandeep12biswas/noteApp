// The lavender title bar (issue #40). Both desktop shells hide the native
// frame, so this bar is what the user drags the window by, where the app
// name and current page show, and where the window buttons live. The
// buttons follow the desktop's own placement and order (resolveWindowChrome
// in @flownote/ipc-adapter; on Linux read from KDE's kwinrc or GNOME's
// button-layout), so a desktop set up with close-minimise-maximise on the
// left gets them on the left here too. Renders nothing in a plain browser
// or where the native frame is kept (macOS).
import { useEffect, useState, type ReactElement } from 'react'
import { resolveWindowChrome, type WindowButton, type WindowChrome, type WindowControls } from '@flownote/ipc-adapter'
import iconUrl from '../assets/flownote-icon.svg'
import { useNotebookStore } from '../store/notebookStore'

export const TITLE_BAR_HEIGHT = 36

const LABELS: Record<WindowButton, string> = { minimize: 'Minimise', maximize: 'Maximise', close: 'Close' }

const GLYPHS: Record<WindowButton, ReactElement> = {
  minimize: <path d="M0 5h10" stroke="currentColor" />,
  maximize: <rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" />,
  close: <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />,
}

function WindowButtons({ buttons, controls }: { buttons: WindowButton[]; controls: WindowControls }) {
  if (buttons.length === 0) return null
  const action: Record<WindowButton, () => Promise<void>> = {
    minimize: controls.minimize,
    maximize: controls.toggleMaximize,
    close: controls.close,
  }
  return (
    <div className="flex h-full">
      {buttons.map((b) => (
        <button
          key={b}
          type="button"
          aria-label={LABELS[b]}
          className={'flex h-full w-11 items-center justify-center text-white/90 hover:bg-white/15' + (b === 'close' ? ' hover:!bg-red-600' : '')}
          onClick={() => void action[b]()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            {GLYPHS[b]}
          </svg>
        </button>
      ))}
    </div>
  )
}

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
  const { layout, controls } = chrome

  return (
    <div
      className={'flownote-titlebar flex shrink-0 select-none items-center gap-2 text-white ' + (layout.left.length ? '' : 'pl-3')}
      style={{ height: TITLE_BAR_HEIGHT }}
      // Dragging — and double-click to maximise — is handled by the shell
      // itself: Electron via `app-region: drag` (index.css), Tauri via this.
      data-tauri-drag-region=""
      data-testid="title-bar"
      data-buttons-side={layout.left.length ? 'left' : 'right'}
    >
      <WindowButtons buttons={layout.left} controls={controls} />
      <img src={iconUrl} alt="" className="pointer-events-none h-5 w-5" />
      <span className="pointer-events-none flex-1 truncate text-[13px] font-semibold tracking-wide">{title}</span>
      <WindowButtons buttons={layout.right} controls={controls} />
    </div>
  )
}
