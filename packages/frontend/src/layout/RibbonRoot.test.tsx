import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RibbonRoot } from './RibbonRoot'
import { useInkStore } from '../store/inkStore'
import { useUIStore } from '../store/uiStore'

afterEach(cleanup)
beforeEach(() => {
  useUIStore.setState({ activeRibbonTab: 'Home' })
  useInkStore.setState({ tool: 'pen', color: '#111827' })
})

describe('RibbonRoot Draw tab', () => {
  it('shows the ink tool switcher only on the Draw tab', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)

    expect(screen.queryByRole('group', { name: 'Ink tool' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Draw' }))
    expect(screen.getByRole('group', { name: 'Ink tool' })).toBeInTheDocument()
  })

  it('switching tools updates inkStore', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'Draw' }))

    await user.click(screen.getByRole('button', { name: 'eraser' }))
    expect(useInkStore.getState().tool).toBe('eraser')
  })

  it('picking a colour updates inkStore', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'Draw' }))

    await user.click(screen.getByRole('button', { name: 'Colour #dc2626' }))
    expect(useInkStore.getState().color).toBe('#dc2626')
  })
})
