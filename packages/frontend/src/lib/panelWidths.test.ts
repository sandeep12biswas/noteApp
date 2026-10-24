import { afterEach, describe, expect, it } from 'vitest'
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTHS,
  loadPanelWidths,
  MAX_PANEL_WIDTH,
  MIN_EDITOR_WIDTH,
  MIN_PANEL_WIDTH,
  savePanelWidths,
} from './panelWidths'

afterEach(() => localStorage.clear())

describe('clampPanelWidth', () => {
  it('keeps a width within the panel min/max on a wide window', () => {
    expect(clampPanelWidth(250, 170, 3000)).toBe(250)
    expect(clampPanelWidth(10, 170, 3000)).toBe(MIN_PANEL_WIDTH)
    expect(clampPanelWidth(5000, 170, 3000)).toBe(MAX_PANEL_WIDTH)
  })

  it('leaves the editor its minimum width', () => {
    // window 900, other panel 200 -> at most 900 - 200 - 320 = 380
    expect(clampPanelWidth(450, 200, 900)).toBe(900 - 200 - MIN_EDITOR_WIDTH)
  })

  it('prefers the panel minimum when the window is too narrow for both', () => {
    expect(clampPanelWidth(300, 200, 500)).toBe(MIN_PANEL_WIDTH)
  })

  it('rounds to whole pixels', () => {
    expect(clampPanelWidth(200.6, 0, 3000)).toBe(201)
  })
})

describe('loadPanelWidths / savePanelWidths', () => {
  it('defaults when nothing is saved', () => {
    expect(loadPanelWidths()).toEqual(DEFAULT_PANEL_WIDTHS)
  })

  it('round-trips saved widths', () => {
    savePanelWidths({ folders: 220, pages: 300 })
    expect(loadPanelWidths()).toEqual({ folders: 220, pages: 300 })
  })

  it('ignores corrupt or out-of-range saved data', () => {
    localStorage.setItem('flownote:panelWidths', '{not json')
    expect(loadPanelWidths()).toEqual(DEFAULT_PANEL_WIDTHS)

    localStorage.setItem('flownote:panelWidths', JSON.stringify({ folders: 'wide', pages: 99999 }))
    expect(loadPanelWidths()).toEqual({ folders: DEFAULT_PANEL_WIDTHS.folders, pages: MAX_PANEL_WIDTH })
  })
})
