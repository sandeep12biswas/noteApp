import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { useUIStore } from '../store/uiStore'

afterEach(cleanup)
beforeEach(() => {
  useUIStore.setState({ activeRibbonTab: 'Home' })
})

describe('AppShell', () => {
  it('renders the ribbon, all three panels, and the status bar', () => {
    render(<AppShell />)

    expect(screen.getByTestId('ribbon-root')).toBeInTheDocument()
    expect(screen.getByTestId('section-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('page-list')).toBeInTheDocument()
    expect(screen.getByTestId('editor-pane')).toBeInTheDocument()
    expect(screen.getByTestId('status-bar')).toBeInTheDocument()
  })

  it('shows a Plugins slot in the section sidebar (DESIGN.md §9.5)', () => {
    render(<AppShell />)
    expect(screen.getByTestId('plugins-tab')).toBeInTheDocument()
  })

  it('renders all four ribbon tabs with Home active by default', () => {
    render(<AppShell />)
    for (const tab of ['Home', 'Insert', 'Draw', 'View']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches the active ribbon tab on click', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<AppShell />)

    await user.click(screen.getByRole('tab', { name: 'Insert' }))

    expect(screen.getByRole('tab', { name: 'Insert' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: 'Insert ribbon panel' })).toBeInTheDocument()
  })
})
