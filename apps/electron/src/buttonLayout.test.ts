import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, parseGtkLayout, parseKdeButtons, resolveButtonLayout } from './buttonLayout'

const KWINRC_LEFT = `[Desktops]\nNumber=1\n\n[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nButtonsOnRight=\nlibrary=org.kde.kwin.aurorae.v2\n`

describe('window button layout', () => {
  it('reads KDE buttons on the left, in kwinrc order', () => {
    expect(resolveButtonLayout({ desktop: 'KDE', readKwinrc: () => KWINRC_LEFT, readGsettings: () => null })).toEqual({
      left: ['close', 'minimize', 'maximize'],
      right: [],
    })
  })

  it("falls back to Plasma's defaults when kwinrc doesn't set them", () => {
    expect(resolveButtonLayout({ desktop: 'KDE', readKwinrc: () => null, readGsettings: () => null })).toEqual({
      left: [],
      right: ['minimize', 'maximize', 'close'],
    })
  })

  it('drops KDE buttons the app has no equivalent for (menu, pin, help)', () => {
    expect(parseKdeButtons('MS', 'HIAX')).toEqual({ left: [], right: ['minimize', 'maximize', 'close'] })
  })

  it('reads the GNOME/GTK layout (gsettings prints it quoted)', () => {
    expect(resolveButtonLayout({ desktop: 'GNOME', readKwinrc: () => null, readGsettings: () => "'close,minimize,maximize:'\n" })).toEqual({
      left: ['close', 'minimize', 'maximize'],
      right: [],
    })
    expect(parseGtkLayout('appmenu:minimize,close')).toEqual({ left: [], right: ['minimize', 'close'] })
  })

  it('uses minimise/maximise/close on the right when nothing can be read', () => {
    expect(resolveButtonLayout({ desktop: 'XFCE', readKwinrc: () => null, readGsettings: () => null })).toEqual(DEFAULT_LAYOUT)
    expect(resolveButtonLayout({ desktop: '', readKwinrc: () => null, readGsettings: () => 'garbage' })).toEqual(DEFAULT_LAYOUT)
  })
})
