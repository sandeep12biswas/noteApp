// Lavender title bar (issue #40): what it draws for each shell's window
// chrome, and that the window buttons follow the desktop's placement.
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BUTTON_LAYOUT, type ButtonLayout } from '@flownote/ipc-adapter'
import { TitleBar } from './TitleBar'
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useNotebookStore.setState({ folders: {}, files: {}, selectedFolderId: null, selectedFileId: null, maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH })
})

function controls() {
  return { minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}) }
}

function custom(layout: ButtonLayout = DEFAULT_BUTTON_LAYOUT, c = controls()) {
  return { kind: 'custom' as const, layout, controls: c }
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
})
