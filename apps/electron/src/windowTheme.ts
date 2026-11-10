// The desktop's window-button artwork, so the frameless window's title bar
// (packages/frontend/src/layout/TitleBar.tsx) shows the same close /
// minimise / maximise buttons as every other window, not generic glyphs.
//
// Supported: KDE window decorations made with Aurorae (the SVG theme engine
// most downloadable themes use — WhiteSur, Mkos-BigSur, MacVentura, …).
// Each button is one SVG holding every state (`active-center`,
// `hover-center`, `pressed-center`, `inactive-center`, …) as separate named
// elements; the renderer crops out the one it needs. Breeze (drawn in C++)
// and GNOME/GTK themes (CSS) have no files to borrow, so those desktops get
// `null` and the bar's own simple buttons.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ButtonTheme } from '@flownote/ipc-adapter'
import { iniValue } from './buttonLayout'

const AURORAE_PREFIX = '__aurorae__svg__'
/** A button SVG bigger than this isn't plausible theme art; skip rather than ship megabytes over IPC. */
const MAX_SVG_BYTES = 512 * 1024

export interface ThemeFs {
  configHome: string
  dataDirs: string[]
  read: (path: string) => string | null
}

/** The Aurorae theme KWin uses, or null for Breeze / any non-Aurorae decoration. The user's kwinrc wins over the global theme's defaults (kdedefaults/kwinrc), which is where Plasma writes it when the theme came with a global look-and-feel package. */
export function activeAuroraeTheme(fs: ThemeFs): string | null {
  for (const file of [join(fs.configHome, 'kwinrc'), join(fs.configHome, 'kdedefaults', 'kwinrc')]) {
    const text = fs.read(file)
    if (!text) continue
    const library = iniValue(text, 'org.kde.kdecoration2', 'library')
    const theme = iniValue(text, 'org.kde.kdecoration2', 'theme')
    if (theme) return theme.startsWith(AURORAE_PREFIX) ? theme.slice(AURORAE_PREFIX.length) : null
    if (library && library !== 'org.kde.kwin.aurorae' && library !== 'org.kde.kwin.aurorae.v2') return null
  }
  return null
}

function num(text: string, key: string, fallback: number): number {
  const v = Number(iniValue(text, 'Layout', key))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export function loadAuroraeTheme(name: string, fs: ThemeFs): ButtonTheme | null {
  // Theme names are directory names; refuse anything that could walk out of the themes folder.
  if (!/^[\w .+-]+$/.test(name) || name.includes('..')) return null
  for (const dir of fs.dataDirs.map((d) => join(d, 'aurorae', 'themes', name))) {
    const read = (file: string) => {
      const text = fs.read(join(dir, file))
      return text && text.length <= MAX_SVG_BYTES ? text : null
    }
    const close = read('close.svg')
    const minimize = read('minimize.svg')
    const maximize = read('maximize.svg')
    if (!close || !minimize || !maximize) continue
    const rc = fs.read(join(dir, `${name}rc`)) ?? ''
    return {
      kind: 'aurorae',
      name,
      svgs: { close, minimize, maximize, restore: read('restore.svg') ?? maximize },
      buttonWidth: num(rc, 'ButtonWidth', 16),
      buttonHeight: num(rc, 'ButtonHeight', 16),
      spacing: num(rc, 'ButtonSpacing', 4),
      edge: num(rc, 'TitleEdgeLeft', 8),
    }
  }
  return null
}

export function resolveButtonTheme(desktop: string, fs: ThemeFs): ButtonTheme | null {
  if (!/kde/i.test(desktop)) return null
  const name = activeAuroraeTheme(fs)
  return name ? loadAuroraeTheme(name, fs) : null
}

export function systemButtonTheme(): ButtonTheme | null {
  if (process.platform !== 'linux' || process.env.FLOWNOTE_TITLEBAR_BUTTONS) return null
  const home = homedir()
  const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share')
  const dataDirs = [dataHome, ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean)]
  return resolveButtonTheme(process.env.XDG_CURRENT_DESKTOP ?? '', {
    configHome: process.env.XDG_CONFIG_HOME || join(home, '.config'),
    dataDirs,
    read: (p) => {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return null
      }
    },
  })
}
