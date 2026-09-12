// DESIGN.md §4.3 "Dual mode: canvas and linear" — the status bar's mode
// label doubles as the mode toggle (Phase 5 "Mode toggle").
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusBar } from './StatusBar'
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useNotebookStore.setState({
    folders: {},
    files: {},
    selectedFolderId: null,
    selectedFileId: null,
    maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH,
  })
})

function seedSelectedFile() {
  const store = useNotebookStore.getState()
  const folder = store.createFolder(null, 'Notes')
  const file = store.createFile(folder.id!, 'Todo')
  store.selectFolder(folder.id!)
  store.selectFile(file.id!)
  return file.id!
}

describe('StatusBar mode toggle', () => {
  it('shows "Canvas" as a static label when no page is selected', () => {
    render(<StatusBar />)
    expect(screen.getByText('Canvas')).toBeInTheDocument()
    // No mode-toggle button when there's no selected page — the theme
    // toggle (ThemeToggle.tsx) is unrelated and always renders.
    expect(screen.queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument()
  })

  it('shows the selected page\'s mode and toggles it on click', async () => {
    const fileId = seedSelectedFile()
    const user = userEvent.setup()
    render(<StatusBar />)

    const toggle = screen.getByRole('button', { name: 'Switch to linear mode' })
    expect(toggle).toHaveTextContent('canvas')

    await user.click(toggle)
    expect(useNotebookStore.getState().files[fileId]?.mode).toBe('linear')
    expect(screen.getByRole('button', { name: 'Switch to canvas mode' })).toHaveTextContent('linear')

    await user.click(screen.getByRole('button', { name: 'Switch to canvas mode' }))
    expect(useNotebookStore.getState().files[fileId]?.mode).toBe('canvas')
  })
})
