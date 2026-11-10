import { describe, expect, it } from 'vitest'
import { activeAuroraeTheme, loadAuroraeTheme, resolveButtonTheme, type ThemeFs } from './windowTheme'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g id="active-center"/></svg>'

function fsWith(files: Record<string, string>): ThemeFs {
  return { configHome: '/cfg', dataDirs: ['/home/u/.local/share', '/usr/share'], read: (p) => files[p] ?? null }
}

const THEME_FILES = {
  '/home/u/.local/share/aurorae/themes/Mkos-BigSur-Night/close.svg': SVG,
  '/home/u/.local/share/aurorae/themes/Mkos-BigSur-Night/minimize.svg': SVG,
  '/home/u/.local/share/aurorae/themes/Mkos-BigSur-Night/maximize.svg': SVG,
  '/home/u/.local/share/aurorae/themes/Mkos-BigSur-Night/Mkos-BigSur-Nightrc': '[General]\nLeftButtons=XIA\n\n[Layout]\nButtonWidth=16\nButtonHeight=18\nButtonSpacing=10\nTitleEdgeLeft=16\n',
}

describe('KDE Aurorae window-button theme', () => {
  it("finds the theme in the global theme's defaults when the user's kwinrc doesn't name one", () => {
    const fs = fsWith({
      '/cfg/kwinrc': '[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nlibrary=org.kde.kwin.aurorae.v2\n',
      '/cfg/kdedefaults/kwinrc': '[org.kde.kdecoration2]\ntheme=__aurorae__svg__Mkos-BigSur-Night\n',
    })
    expect(activeAuroraeTheme(fs)).toBe('Mkos-BigSur-Night')
  })

  it("the user's own kwinrc wins, and Breeze means no theme art", () => {
    const fs = fsWith({
      '/cfg/kwinrc': '[org.kde.kdecoration2]\nlibrary=org.kde.breeze\ntheme=Breeze\n',
      '/cfg/kdedefaults/kwinrc': '[org.kde.kdecoration2]\ntheme=__aurorae__svg__WhiteSur\n',
    })
    expect(activeAuroraeTheme(fs)).toBeNull()
  })

  it('loads the button SVGs and sizes, using maximize.svg when a theme has no restore.svg', () => {
    const theme = loadAuroraeTheme('Mkos-BigSur-Night', fsWith(THEME_FILES))
    expect(theme).toMatchObject({ kind: 'aurorae', buttonWidth: 16, buttonHeight: 18, spacing: 10, edge: 16 })
    expect(theme?.svgs.restore).toBe(SVG)
  })

  it('refuses theme names that could leave the themes folder', () => {
    expect(loadAuroraeTheme('../../etc', fsWith(THEME_FILES))).toBeNull()
  })

  it('only applies on KDE', () => {
    const fs = fsWith({ ...THEME_FILES, '/cfg/kwinrc': '[org.kde.kdecoration2]\ntheme=__aurorae__svg__Mkos-BigSur-Night\n' })
    expect(resolveButtonTheme('GNOME', fs)).toBeNull()
    expect(resolveButtonTheme('KDE', fs)?.name).toBe('Mkos-BigSur-Night')
  })
})
