// Where the desktop puts a window's minimise/maximise/close buttons, so the
// frameless window's own title bar (packages/frontend/src/layout/TitleBar.tsx)
// can match it — e.g. KDE or GNOME set up with the buttons on the left,
// macOS-style. Electron's Window Controls Overlay always draws them on the
// right, which is why the window doesn't use it on Linux.
//
// Sources, in order: KDE's kwinrc (when running under Plasma), then the
// GNOME/GTK `button-layout` setting (also what KDE syncs for GTK apps),
// then the common default: everything on the right.
// FLOWNOTE_TITLEBAR_BUTTONS overrides all of them.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ButtonLayout, WindowButton } from '@flownote/ipc-adapter'

export const DEFAULT_LAYOUT: ButtonLayout = { left: [], right: ['minimize', 'maximize', 'close'] }

const KDE_LETTERS: Record<string, WindowButton> = { I: 'minimize', A: 'maximize', X: 'close' }
const GTK_NAMES: Record<string, WindowButton> = { minimize: 'minimize', maximize: 'maximize', close: 'close' }

/** KDE's ButtonsOnLeft/ButtonsOnRight: one letter per button (X close, I minimise, A maximise; others — menu, pin, help… — aren't drawn). */
export function parseKdeButtons(left: string, right: string): ButtonLayout {
  const pick = (s: string) => [...s].map((c) => KDE_LETTERS[c]).filter((b): b is WindowButton => !!b)
  return { left: pick(left), right: pick(right) }
}

/** GTK's `button-layout` / `gtk-decoration-layout`: "close,minimize,maximize:" — buttons before the colon go on the left, after it on the right. */
export function parseGtkLayout(value: string): ButtonLayout | null {
  const v = value.trim().replace(/^'|'$/g, '')
  if (!v.includes(':')) return null
  const [l = '', r = ''] = v.split(':', 2)
  const pick = (s: string) => s.split(',').map((n) => GTK_NAMES[n.trim()]).filter((b): b is WindowButton => !!b)
  return { left: pick(l), right: pick(r) }
}

/** Reads `[section] key=value` out of an INI-style file's text. */
export function iniValue(text: string, section: string, key: string): string | undefined {
  let inSection = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) inSection = line === `[${section}]`
    else if (inSection) {
      const eq = line.indexOf('=')
      if (eq > 0 && line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim()
    }
  }
  return undefined
}

export interface LayoutSources {
  desktop: string
  readKwinrc: () => string | null
  readGsettings: () => string | null
}

export function resolveButtonLayout(src: LayoutSources): ButtonLayout {
  if (/kde/i.test(src.desktop)) {
    const text = src.readKwinrc()
    // Plasma's own defaults when kwinrc doesn't set them: menu + pin on the left, help/minimise/maximise/close on the right.
    const left = (text && iniValue(text, 'org.kde.kdecoration2', 'ButtonsOnLeft')) ?? 'MS'
    const right = (text && iniValue(text, 'org.kde.kdecoration2', 'ButtonsOnRight')) ?? 'HIAX'
    return parseKdeButtons(left, right)
  }
  const gtk = src.readGsettings()
  return (gtk && parseGtkLayout(gtk)) || DEFAULT_LAYOUT
}

/** The real desktop's layout. Read each time it's asked for, so a settings change shows up on the next launch/reload. */
export function systemButtonLayout(): ButtonLayout {
  // Override in GTK syntax (e.g. ":minimize,maximize,close"); the guides'
  // screenshot script sets it so the docs don't depend on whoever ran it.
  const forced = process.env.FLOWNOTE_TITLEBAR_BUTTONS
  if (forced) return parseGtkLayout(forced) ?? DEFAULT_LAYOUT
  if (process.platform !== 'linux') return DEFAULT_LAYOUT
  return resolveButtonLayout({
    desktop: process.env.XDG_CURRENT_DESKTOP ?? '',
    readKwinrc: () => {
      try {
        return readFileSync(join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'kwinrc'), 'utf8')
      } catch {
        return null
      }
    },
    readGsettings: () => {
      try {
        return execFileSync('gsettings', ['get', 'org.gnome.desktop.wm.preferences', 'button-layout'], { encoding: 'utf8', timeout: 1500 })
      } catch {
        return null
      }
    },
  })
}
