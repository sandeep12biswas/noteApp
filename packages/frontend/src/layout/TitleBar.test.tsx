// Lavender title bar (issue #40): what it draws for each shell's window chrome.
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from './TitleBar'
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useNotebookStore.setState({ folders: {}, files: {}, selectedFolderId: null, selectedFileId: null, maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH })
})

function controls() {
  return { minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}) }
}

describe('TitleBar', () => {
  it('renders nothing when the native frame is still there (browser, tests)', async () => {
    render(<TitleBar />)
    // resolveWindowChrome() finds neither Tauri nor a Window Controls Overlay.
    await Promise.resolve()
    expect(screen.queryByTestId('title-bar')).not.toBeInTheDocument()
  })

  it('shows the app name, then the selected page, and mirrors it in document.title', () => {
    render(<TitleBar chrome={{ kind: 'overlay' }} />)
    expect(screen.getByTestId('title-bar')).toHaveTextContent('FlowNote')
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Work')
    const file = store.createFile(folder.id!, 'Meeting notes')
    act(() => store.selectFile(file.id!))
    expect(screen.getByTestId('title-bar')).toHaveTextContent('Meeting notes — FlowNote')
    return vi.waitFor(() => expect(document.title).toBe('Meeting notes — FlowNote'))
  })

  it('leaves window buttons to the OS under Electron\'s overlay', () => {
    render(<TitleBar chrome={{ kind: 'overlay' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws its own window buttons for a frameless Tauri window', async () => {
    const c = controls()
    const user = userEvent.setup()
    render(<TitleBar chrome={{ kind: 'custom', controls: c }} />)
    await user.click(screen.getByRole('button', { name: 'Minimise' }))
    await user.click(screen.getByRole('button', { name: 'Maximise' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(c.minimize).toHaveBeenCalledOnce()
    expect(c.toggleMaximize).toHaveBeenCalledOnce()
    expect(c.close).toHaveBeenCalledOnce()
  })

  it('maximises on double-click of the bar', async () => {
    const c = controls()
    const user = userEvent.setup()
    render(<TitleBar chrome={{ kind: 'custom', controls: c }} />)
    await user.dblClick(screen.getByTestId('title-bar'))
    expect(c.toggleMaximize).toHaveBeenCalledOnce()
  })
})
