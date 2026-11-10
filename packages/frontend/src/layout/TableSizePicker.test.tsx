import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableSizePicker } from './TableSizePicker'

afterEach(cleanup)

describe('TableSizePicker', () => {
  it('inserts the size clicked', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<TableSizePicker x={0} y={0} onPick={onPick} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: '4 by 5 table' }))
    expect(onPick).toHaveBeenCalledWith(4, 5)
  })

  it('works from the keyboard: starts at 3 × 3, arrows resize, Enter inserts, Escape closes', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<TableSizePicker x={0} y={0} onPick={onPick} onClose={onClose} />)
    expect(screen.getByRole('button', { name: '3 by 3 table' })).toHaveFocus()
    expect(screen.getByText('3 × 3 table')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{ArrowRight}{ArrowRight}')
    expect(screen.getByText('4 × 5 table')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith(4, 5)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it("doesn't go past 1 × 1 or the grid's edge", async () => {
    const user = userEvent.setup()
    render(<TableSizePicker x={0} y={0} onPick={() => {}} onClose={() => {}} />)
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(screen.getByText('1 × 1 table')).toBeInTheDocument()
  })
})
