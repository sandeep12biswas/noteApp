// Phase 6 "Accessibility pass" — focus trap / arrow-key nav in menus.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useMenuKeyboardNav } from './useMenuKeyboardNav'

function TestMenu({ autoFocus }: { autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref, { autoFocus })
  return (
    <div ref={ref} role="menu">
      <button role="menuitem">One</button>
      <button role="menuitem">Two</button>
      <button role="menuitemradio">Three</button>
    </div>
  )
}

afterEach(cleanup)

describe('useMenuKeyboardNav', () => {
  it('focuses the first item on mount by default', () => {
    render(<TestMenu />)
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
  })

  it('does not steal focus when autoFocus is false', () => {
    const { container } = render(
      <>
        <input aria-label="Elsewhere" />
        <TestMenu autoFocus={false} />
      </>,
    )
    expect(container.querySelector('[aria-label="Elsewhere"]')).not.toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'One' })).not.toHaveFocus()
  })

  it('ArrowDown/ArrowUp move focus among items, wrapping at the ends', async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Two' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Three' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitemradio', { name: 'Three' })).toHaveFocus()
  })

  it('Home/End jump to the first/last item', async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitemradio', { name: 'Three' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
  })
})
