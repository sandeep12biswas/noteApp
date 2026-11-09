// Right-click Segment colour menu — the same palette as Page colour.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SegmentColorMenu } from './SegmentColorMenu'
import { COLOR_SHADES } from '../lib/colorShades'
import { useRecentSegmentColors } from '../lib/recentColors'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  useRecentSegmentColors.setState({ colors: [] })
})

function renderMenu(activeColor: string | null = null) {
  const onPick = vi.fn()
  const onClear = vi.fn()
  const onDelete = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <SegmentColorMenu x={10} y={10} activeColor={activeColor} onPick={onPick} onClear={onClear} onDelete={onDelete} onClose={onClose} />,
  )
  return { onPick, onClear, onDelete, onClose, menu: screen.getByRole('menu', { name: 'Segment colour' }), ...view }
}

describe('SegmentColorMenu', () => {
  it('keeps the 9 original colours as quick picks', async () => {
    const { menu, onPick, onClose } = renderMenu()
    expect(within(within(menu).getByRole('group', { name: 'Colour quick picks' })).getAllByRole('menuitemradio')).toHaveLength(9)
    await userEvent.setup().click(within(menu).getByRole('menuitemradio', { name: 'Colour #dc2626' }))
    expect(onPick).toHaveBeenCalledWith('#dc2626', 'rgba(220, 38, 38, 0.08)')
    expect(onClose).toHaveBeenCalled()
  })

  it('offers a shade grid without the two palest rows (an invisible border)', async () => {
    const { menu, onPick } = renderMenu()
    const grid = within(menu).getByRole('group', { name: 'Colour shades' })
    expect(within(grid).getAllByRole('menuitemradio')).toHaveLength(COLOR_SHADES.length * 8)
    expect(within(grid).queryByRole('menuitemradio', { name: 'Colour Blue lightest' })).toBeNull()
    await userEvent.setup().click(within(grid).getByRole('menuitemradio', { name: 'Colour Purple darkest' }))
    expect(onPick).toHaveBeenCalledWith('#581c87', 'rgba(88, 28, 135, 0.08)')
  })

  it('marks the current colour, wherever it is in the palette', () => {
    const { menu } = renderMenu('#0f766e')
    expect(within(menu).getByRole('menuitemradio', { name: 'Colour Teal dark' })).toHaveAttribute('aria-checked', 'true')
  })

  it('the colour wheel applies any colour with its matching fill and remembers it', async () => {
    const user = userEvent.setup()
    const { menu, onPick, unmount } = renderMenu()
    await user.click(within(menu).getByRole('menuitem', { name: 'More colours…' }))
    const hex = within(menu).getByRole('textbox', { name: 'Hex colour' })
    await user.clear(hex)
    await user.type(hex, '#123456')
    await user.click(within(menu).getByRole('menuitem', { name: 'Apply' }))
    expect(onPick).toHaveBeenCalledWith('#123456', 'rgba(18, 52, 86, 0.08)')
    expect(useRecentSegmentColors.getState().colors).toEqual(['#123456'])
    unmount()

    const again = renderMenu('#123456').menu
    expect(within(again).getByRole('menuitemradio', { name: 'Colour recent #123456' })).toHaveAttribute('aria-checked', 'true')
  })

  it('"None" clears the colour', async () => {
    const { menu, onClear, onClose } = renderMenu('#dc2626')
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'None' }))
    expect(onClear).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('offers "Delete segment" last, after a separator', async () => {
    const { menu, onDelete, onClose } = renderMenu('#dc2626')
    const items = within(menu).getAllByRole('menuitem')
    expect(items[items.length - 1]).toHaveAccessibleName('Delete segment')
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Delete segment' }))
    expect(onDelete).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled() // the host unmounts the menu along with the segment
  })
})
