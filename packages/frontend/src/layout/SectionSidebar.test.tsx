import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SectionSidebar } from './SectionSidebar'
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

describe('SectionSidebar', () => {
  it('shows "No folders yet" when empty', () => {
    render(<SectionSidebar />)
    expect(screen.getByText('No folders yet')).toBeInTheDocument()
  })

  it('creates a folder and auto-capitalizes the typed name', async () => {
    const user = userEvent.setup()
    render(<SectionSidebar />)

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'projects{Enter}')

    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('lists root folders in natural order with file counts', async () => {
    const store = useNotebookStore.getState()
    const a = store.createFolder(null, 'Folder 10')
    const b = store.createFolder(null, 'Folder 2')
    store.createFile(b.id!, 'Note')

    render(<SectionSidebar />)
    const items = within(screen.getByRole('list', { name: 'Folder tree' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Folder 2')
    expect(items[1]).toHaveTextContent('Folder 10')
    expect(screen.getByLabelText('1 files')).toBeInTheDocument()
    void a
  })

  it('selecting a folder highlights it', async () => {
    const store = useNotebookStore.getState()
    store.createFolder(null, 'Notes')
    const user = userEvent.setup()
    render(<SectionSidebar />)

    await user.click(screen.getByText('Notes'))
    expect(useNotebookStore.getState().selectedFolderId).not.toBeNull()
  })

  it('shows an expand affordance only for folders with children, and toggles visibility', async () => {
    const store = useNotebookStore.getState()
    const parent = store.createFolder(null, 'Parent')
    store.createFolder(parent.id!, 'Child')
    const user = userEvent.setup()
    render(<SectionSidebar />)

    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand Parent' }))
    expect(screen.getByText('Child')).toBeInTheDocument()
  })

  it('renders the Plugins slot', () => {
    render(<SectionSidebar />)
    expect(screen.getByTestId('plugins-tab')).toBeInTheDocument()
  })
})
