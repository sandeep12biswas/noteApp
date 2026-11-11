// Lavender title bar (issue #40): what it draws for each shell's window
// chrome, and that the window buttons follow the desktop's placement.
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BUTTON_LAYOUT, type ButtonLayout, type ButtonTheme } from '@flownote/ipc-adapter'
import { TitleBar } from './TitleBar'

// The real cropping needs a layout engine (jsdom has no getBBox); here each
// state's "image" is just a name, so the tests can see which one is shown.
vi.mock('../lib/auroraeButtons', async (orig) => {
  const real = await orig<typeof import('../lib/auroraeButtons')>()
  const states = { active: 'A', inactive: 'I', hover: 'H', pressed: 'P' }
  const art = (n: string) => Object.fromEntries(Object.entries(states).map(([s, v]) => [s, `${n}:${v}`]))
  return { ...real, buildButtonArt: () => ({ close: art('close'), minimize: art('minimize'), maximize: art('maximize'), restore: art('restore') }) }
})

const THEME: ButtonTheme = { kind: 'aurorae', name: 'Mkos-BigSur-Night', svgs: { close: '', minimize: '', maximize: '', restore: '' }, buttonWidth: 16, buttonHeight: 16, spacing: 10, edge: 16 }
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useNotebookStore.setState({ folders: {}, files: {}, selectedFolderId: null, selectedFileId: null, maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH })
})

function controls() {
  return { minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}), isMaximized: vi.fn(async () => false) }
}

function custom(layout: ButtonLayout = DEFAULT_BUTTON_LAYOUT, c = controls()) {
  return { kind: 'custom' as const, layout, theme: null, rounded: false, controls: c }
}

/** Accessible names of the bar's children, left to right: buttons by label, the title as "title". */
function order(): string[] {
  const bar = screen.getByTestId('title-bar')
  return [...bar.querySelectorAll('button, span')].map((el) => el.getAttribute('aria-label') ?? 'title')
}

describe('TitleBar', () => {
  it('renders nothing when the native frame is still there (browser, tests)', async () => {
    render(<TitleBar />)
    await Promise.resolve()
    expect(screen.queryByTestId('title-bar')).not.toBeInTheDocument()
  })

  it('shows the app name, then the selected page, and mirrors it in document.title', async () => {
    render(<TitleBar chrome={custom()} />)
    expect(screen.getByTestId('title-bar')).toHaveTextContent('FlowNote')
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Work')
    const file = store.createFile(folder.id!, 'Meeting notes')
    act(() => store.selectFile(file.id!))
    expect(screen.getByTestId('title-bar')).toHaveTextContent('Meeting notes — FlowNote')
    await vi.waitFor(() => expect(document.title).toBe('Meeting notes — FlowNote'))
  })

  it('puts the buttons on the right by default', () => {
    render(<TitleBar chrome={custom()} />)
    expect(order()).toEqual(['title', 'Minimise', 'Maximise', 'Close'])
  })

  it('honours a desktop with close-minimise-maximise on the left (e.g. KDE/GNOME macOS-style)', () => {
    render(<TitleBar chrome={custom({ left: ['close', 'minimize', 'maximize'], right: [] })} />)
    expect(order()).toEqual(['Close', 'Minimise', 'Maximise', 'title'])
    expect(screen.getByTestId('title-bar')).toHaveAttribute('data-buttons-side', 'left')
  })

  it('draws only the buttons the desktop shows, split across both sides', () => {
    render(<TitleBar chrome={custom({ left: ['close'], right: ['minimize'] })} />)
    expect(order()).toEqual(['Close', 'title', 'Minimise'])
  })

  it('wires each button to its window action', async () => {
    const c = controls()
    const user = userEvent.setup()
    render(<TitleBar chrome={custom(DEFAULT_BUTTON_LAYOUT, c)} />)
    await user.click(screen.getByRole('button', { name: 'Minimise' }))
    await user.click(screen.getByRole('button', { name: 'Maximise' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(c.minimize).toHaveBeenCalledOnce()
    expect(c.toggleMaximize).toHaveBeenCalledOnce()
    expect(c.close).toHaveBeenCalledOnce()
  })

  describe('with the desktop theme\'s button art (KDE Aurorae)', () => {
    const themed = (c = controls()) => ({ kind: 'custom' as const, layout: { left: ['close', 'minimize', 'maximize'] as const, right: [] as const } as unknown as ButtonLayout, theme: THEME, rounded: false, controls: c })
    const img = (name: string) => screen.getByRole('button', { name }).querySelector('img')?.getAttribute('src')
    // jsdom's document never has focus; a real app window starts focused.
    beforeEach(() => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    })
    afterEach(() => vi.restoreAllMocks())

    it("draws each button with the theme's art at the theme's size, in the desktop's order", () => {
      render(<TitleBar chrome={themed()} />)
      expect(screen.getByTestId('title-bar')).toHaveAttribute('data-button-theme', 'Mkos-BigSur-Night')
      expect(order()).toEqual(['Close', 'Minimise', 'Maximise', 'title'])
      expect(img('Close')).toBe('close:A')
      expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({ width: '16px', height: '16px' })
    })

    it('switches to the hover and pressed art like the other windows do', async () => {
      const user = userEvent.setup()
      render(<TitleBar chrome={themed()} />)
      await user.hover(screen.getByRole('button', { name: 'Minimise' }))
      expect(img('Minimise')).toBe('minimize:H')
      await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('button', { name: 'Minimise' }) })
      expect(img('Minimise')).toBe('minimize:P')
    })

    it('uses the inactive art while the window is unfocused', () => {
      render(<TitleBar chrome={themed()} />)
      act(() => {
        window.dispatchEvent(new Event('blur'))
      })
      expect(img('Close')).toBe('close:I')
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
      expect(img('Close')).toBe('close:A')
    })

    it('shows the restore art when the window is maximised', async () => {
      const c = controls()
      c.isMaximized.mockResolvedValue(true)
      render(<TitleBar chrome={themed(c)} />)
      await vi.waitFor(() => expect(img('Restore')).toBe('restore:A'))
    })
  })
})
