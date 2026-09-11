import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EditorPane } from './EditorPane'
import { PageList } from './PageList'
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
    await user.type(title, 'lowercase')
    await user.tab()

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(useNotebookStore.getState().files[fileId]?.name).toBe('Todo')
  })

  it('shows the placeholder chrome when no page is selected', () => {
    render(<EditorPane />)
    expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument()
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })
})
