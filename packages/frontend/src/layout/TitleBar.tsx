// The lavender title bar (issue #40). Both desktop shells hide the native
// frame, so this bar is what the user drags the window by, where the app
// name and current page show, and where the window buttons live. The
// buttons follow the desktop's own placement and order (resolveWindowChrome
// in @flownote/ipc-adapter; on Linux read from KDE's kwinrc or GNOME's
// button-layout), so a desktop set up with close-minimise-maximise on the
// left gets them on the left here too — and, where the desktop theme's
// button artwork can be read (KDE Aurorae themes), they're drawn with it,
// so they look like every other window's. Renders nothing in a plain
// browser or where the native frame is kept (macOS).
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { resolveWindowChrome, type ButtonTheme, type WindowButton, type WindowChrome, type WindowControls } from '@flownote/ipc-adapter'
import iconUrl from '../assets/flownote-icon.svg'
import { artFor, buildButtonArt, type ButtonArt, type ButtonState } from '../lib/auroraeButtons'
import { useNotebookStore } from '../store/notebookStore'

export const TITLE_BAR_HEIGHT = 36

const LABELS: Record<WindowButton, string> = { minimize: 'Minimise', maximize: 'Maximise', close: 'Close' }

const GLYPHS: Record<WindowButton, ReactElement> = {
  minimize: <path d="M0 5h10" stroke="currentColor" />,
  maximize: <rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" />,
  close: <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />,
}

function actions(controls: WindowControls): Record<WindowButton, () => Promise<void>> {
  return { minimize: controls.minimize, maximize: controls.toggleMaximize, close: controls.close }
}

/** Fallback buttons (no readable desktop theme): simple glyphs. */
function SimpleButtons({ buttons, controls }: { buttons: WindowButton[]; controls: WindowControls }) {
  if (buttons.length === 0) return null
  const action = actions(controls)
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

/** One button drawn with the desktop theme's artwork, following hover / press / window focus like KWin does. */
function ThemedButton({ button, art, theme, focused, maximized, onClick }: {
  button: WindowButton
  art: ButtonArt
  theme: ButtonTheme
  focused: boolean
  maximized: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const [pressed, setPressed] = useState(false)
  const state: ButtonState = pressed && hover ? 'pressed' : hover ? (focused ? 'hover' : 'hover-inactive') : focused ? 'active' : 'inactive'
  const src = artFor(art, button === 'maximize' && maximized ? 'restore' : button, state)
  return (
    <button
      type="button"
      aria-label={button === 'maximize' && maximized ? 'Restore' : LABELS[button]}
      data-state={state}
      className="flex items-center justify-center p-0"
      style={{ width: theme.buttonWidth, height: theme.buttonHeight }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false)
        setPressed(false)
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onClick={onClick}
    >
      {src && <img src={src} alt="" draggable={false} className="pointer-events-none h-full w-full" />}
    </button>
  )
}

function ThemedButtons({ buttons, controls, theme, art, focused, maximized, side }: {
  buttons: WindowButton[]
  controls: WindowControls
  theme: ButtonTheme
  art: ButtonArt
  focused: boolean
  maximized: boolean
  side: 'left' | 'right'
}) {
  if (buttons.length === 0) return null
  const action = actions(controls)
  return (
    <div className="flex h-full items-center" style={{ gap: theme.spacing, [side === 'left' ? 'paddingLeft' : 'paddingRight']: theme.edge }}>
      {buttons.map((b) => (
        <ThemedButton key={b} button={b} art={art} theme={theme} focused={focused} maximized={maximized} onClick={() => void action[b]()} />
      ))}
    </div>
  )
}

/** Window focus (KWin draws buttons differently for an unfocused window). */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => (typeof document === 'undefined' ? true : document.hasFocus()))
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return focused
}

/** Whether the window is maximised (for maximise ↔ restore art), rechecked on every resize. */
function useMaximized(controls: WindowControls | null): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!controls) return
    let live = true
    const check = () => void controls.isMaximized().then((m) => live && setMaximized(m), () => {})
    check()
    window.addEventListener('resize', check)
    return () => {
      live = false
      window.removeEventListener('resize', check)
    }
  }, [controls])
  return maximized
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

  const custom = chrome.kind === 'custom' ? chrome : null
  const theme = custom?.theme ?? null
  const art = useMemo(() => {
    if (!theme) return null
    try {
      return buildButtonArt(theme)
    } catch {
      return null
    }
  }, [theme])
  const focused = useWindowFocused()
  const maximized = useMaximized(theme ? (custom?.controls ?? null) : null)

  if (!custom) return null
  const { layout, controls } = custom
  const buttons = (list: WindowButton[], side: 'left' | 'right') =>
    theme && art ? (
      <ThemedButtons buttons={list} controls={controls} theme={theme} art={art} focused={focused} maximized={maximized} side={side} />
    ) : (
      <SimpleButtons buttons={list} controls={controls} />
    )

  return (
    <div
      className={'flownote-titlebar flex shrink-0 select-none items-center gap-2 text-white ' + (layout.left.length ? '' : 'pl-3')}
      data-button-theme={theme && art ? theme.name : 'simple'}
      style={{ height: TITLE_BAR_HEIGHT }}
      // Dragging — and double-click to maximise — is handled by the shell
      // itself: Electron via `app-region: drag` (index.css), Tauri via this.
      data-tauri-drag-region=""
      data-testid="title-bar"
      data-buttons-side={layout.left.length ? 'left' : 'right'}
    >
      {buttons(layout.left, 'left')}
      <img src={iconUrl} alt="" className="pointer-events-none h-5 w-5" />
      <span className="pointer-events-none flex-1 truncate text-[13px] font-semibold tracking-wide">{title}</span>
      {buttons(layout.right, 'right')}
    </div>
  )
}
