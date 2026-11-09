import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EditorPane } from './EditorPane'
import { PageList } from './PageList'
import { useCanvasStore } from '../store/canvasStore'
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'
import { useEditorBackgroundStore } from '../store/editorBackgroundStore'

afterEach(cleanup)
beforeEach(() => {
  useNotebookStore.setState({
    folders: {},
    files: {},
    selectedFolderId: null,
    selectedFileId: null,
    maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH,
  })
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
})

function seedSelectedFile() {
  const store = useNotebookStore.getState()
  const folder = store.createFolder(null, 'Notes')
  const file = store.createFile(folder.id!, 'Todo')
  store.selectFolder(folder.id!)
  store.selectFile(file.id!)
  return file.id!
}

describe('EditorPane page title', () => {
  it('renders the selected file name as an editable title', () => {
    seedSelectedFile()
    render(<EditorPane />)
    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveValue('Todo')
  })

  it('renames the file on blur and stays in sync with the page list', async () => {
    seedSelectedFile()
    const user = userEvent.setup()
    render(
      <>
        <PageList />
        <EditorPane />
      </>,
    )

    const title = screen.getByRole('textbox', { name: 'Page title' })
    await user.clear(title)
    await user.type(title, 'Roadmap')
    await user.tab()

    expect(useNotebookStore.getState().files[Object.keys(useNotebookStore.getState().files)[0]!]?.name).toBe(
      'Roadmap',
    )
    expect(screen.getByText('Roadmap')).toBeInTheDocument()
  })

  it('shows an error and reverts when the new name is invalid', async () => {
    const fileId = seedSelectedFile()
    const user = userEvent.setup()
    render(<EditorPane />)

    const title = screen.getByRole('textbox', { name: 'Page title' })
    await user.clear(title)
    await user.type(title, '9 lives')
    await user.tab()

    expect(screen.getByRole('alert')).toHaveTextContent('must start with a letter')
    expect(useNotebookStore.getState().files[fileId]?.name).toBe('Todo')
  })

  it('renames the page to a lowercase title (issue #31)', async () => {
    const fileId = seedSelectedFile()
    const user = userEvent.setup()
    render(<EditorPane />)

    const title = screen.getByRole('textbox', { name: 'Page title' })
    await user.clear(title)
    await user.type(title, 'lowercase')
    await user.tab()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(useNotebookStore.getState().files[fileId]?.name).toBe('lowercase')
  })

  it('shows the placeholder chrome when no page is selected', () => {
    render(<EditorPane />)
    expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument()
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })
})

describe('EditorPane mode switch (DESIGN.md §4.3)', () => {
  it('renders CanvasRoot for a canvas-mode page and LinearRoot for a linear-mode one', () => {
    const fileId = seedSelectedFile()
    const { unmount } = render(<EditorPane />)
    expect(screen.getByTestId('canvas-root')).toBeInTheDocument()
    expect(screen.queryByTestId('linear-root')).not.toBeInTheDocument()
    unmount()

    useNotebookStore.getState().setFileMode(fileId, 'linear')
    render(<EditorPane />)
    expect(screen.getByTestId('linear-root')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-root')).not.toBeInTheDocument()
  })

  it('keeps the same segments in the store across a mode switch (no data loss)', () => {
    const fileId = seedSelectedFile()
    const segId = useCanvasStore.getState().createSegment(fileId, 10, 20)

    useNotebookStore.getState().setFileMode(fileId, 'linear')
    useNotebookStore.getState().setFileMode(fileId, 'canvas')

    expect(useCanvasStore.getState().segments[segId]).toBeDefined()
    expect(useCanvasStore.getState().segments[segId]?.x).toBe(10)
  })
})

describe('EditorPane background (issues #11, #12)', () => {
  it('has no background or ink colours when none is chosen', () => {
    seedSelectedFile()
    useEditorBackgroundStore.setState({ defaultBackground: null })
    render(<EditorPane />)
    const pane = screen.getByTestId('editor-pane')
    expect(pane).not.toHaveAttribute('data-editor-ink')
    expect(pane.style.getPropertyValue('--editor-bg')).toBe('')
  })

  it('uses the page colour over the default, with readable ink for it', () => {
    const id = seedSelectedFile()
    useEditorBackgroundStore.setState({ defaultBackground: '#ecfdf5' })
    const { rerender } = render(<EditorPane />)
    const pane = screen.getByTestId('editor-pane')
    expect(pane).toHaveAttribute('data-editor-ink')
    expect(pane.style.getPropertyValue('--editor-bg')).toBe('#ecfdf5')
    expect(pane.style.getPropertyValue('--editor-fg')).toBe('#111827')

    useNotebookStore.getState().setFileBackground(id, '#1e3a8a')
    rerender(<EditorPane />)
    expect(pane.style.getPropertyValue('--editor-bg')).toBe('#1e3a8a')
    expect(pane.style.getPropertyValue('--editor-fg')).toBe('#f9fafb')
    useEditorBackgroundStore.setState({ defaultBackground: null })
  })
})
