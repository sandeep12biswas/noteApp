import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PANEL_WIDTHS, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from '../lib/panelWidths'
import { useUIStore } from '../store/uiStore'
import { PanelResizeHandle } from './PanelResizeHandle'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  // jsdom's window is 1024px wide — wide enough for both panels at max plus the editor minimum? 480+170+320 = 970, yes.
  useUIStore.setState({ panelWidths: { ...DEFAULT_PANEL_WIDTHS }, activeView: 'notebook' })
})

const saved = () => JSON.parse(localStorage.getItem('flownote:panelWidths') ?? 'null')

describe('PanelResizeHandle', () => {
  it('is an accessible vertical separator reporting the current width and limits', () => {
    render(<PanelResizeHandle panel="folders" label="Resize folder panel" />)
    const handle = screen.getByRole('separator', { name: 'Resize folder panel' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', String(DEFAULT_PANEL_WIDTHS.folders))
    expect(handle).toHaveAttribute('aria-valuemin', String(MIN_PANEL_WIDTH))
    expect(handle).toHaveAttribute('aria-valuemax', String(MAX_PANEL_WIDTH))
  })

  it('arrow keys move it 10px (50px with Shift) and save the width', () => {
    render(<PanelResizeHandle panel="folders" label="Resize folder panel" />)
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(useUIStore.getState().panelWidths.folders).toBe(DEFAULT_PANEL_WIDTHS.folders + 10)
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(useUIStore.getState().panelWidths.folders).toBe(DEFAULT_PANEL_WIDTHS.folders + 10 - 50)
    expect(saved().folders).toBe(DEFAULT_PANEL_WIDTHS.folders - 40)
  })

  it('Home/End jump to the min/max width', () => {
    render(<PanelResizeHandle panel="pages" label="Resize page panel" />)
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(useUIStore.getState().panelWidths.pages).toBe(MIN_PANEL_WIDTH)
    fireEvent.keyDown(handle, { key: 'End' })
    expect(useUIStore.getState().panelWidths.pages).toBe(MAX_PANEL_WIDTH)
  })

  it('double-click resets to the default width and saves it', () => {
    useUIStore.setState({ panelWidths: { folders: 300, pages: 250 } })
    render(<PanelResizeHandle panel="pages" label="Resize page panel" />)
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(useUIStore.getState().panelWidths).toEqual({ folders: 300, pages: DEFAULT_PANEL_WIDTHS.pages })
    expect(saved()).toEqual({ folders: 300, pages: DEFAULT_PANEL_WIDTHS.pages })
  })

  it('never lets a panel squeeze the editor below its minimum', () => {
    useUIStore.setState({ panelWidths: { folders: 400, pages: 170 } })
    render(<PanelResizeHandle panel="pages" label="Resize page panel" />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' })
    // 1024 (jsdom window) - 400 (folders) - 320 (editor minimum)
    expect(useUIStore.getState().panelWidths.pages).toBe(1024 - 400 - 320)
  })
})
