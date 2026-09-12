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

  it('creates a nested subfolder via the "+" button, without requiring the parent to already be expanded', async () => {
    const store = useNotebookStore.getState()
    const { id: parentId } = store.createFolder(null, 'Parent')
    const user = userEvent.setup()
    render(<SectionSidebar />)

    // Parent has no children yet, so it starts with no expand arrow and isn't expanded.
    expect(useNotebookStore.getState().folders[parentId!]?.expanded).toBe(false)
    await user.click(screen.getByRole('button', { name: 'New subfolder in Parent' }))
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'child{Enter}')

    const parentFolders = Object.values(useNotebookStore.getState().folders).filter((f) => f.parentId === parentId)
    expect(parentFolders).toHaveLength(1)
    expect(parentFolders[0]?.name).toBe('Child')
  })

  it('right-click opens a menu with New subfolder and Rename', async () => {
    const store = useNotebookStore.getState()
    const { id } = store.createFolder(null, 'Notes')
    const user = userEvent.setup()
    render(<SectionSidebar />)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Notes') })
    const menu = screen.getByRole('menu', { name: 'Folder actions' })
    expect(menu).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename Notes' })
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')
    expect(useNotebookStore.getState().folders[id!]?.name).toBe('Renamed')
  })

  it('right-click "New subfolder" opens the same new-folder input as the "+" button', async () => {
    const store = useNotebookStore.getState()
    store.createFolder(null, 'Notes')
    const user = userEvent.setup()
    render(<SectionSidebar />)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Notes') })
    await user.click(screen.getByRole('menuitem', { name: 'New subfolder' }))
    expect(screen.getByRole('textbox', { name: 'New folder name' })).toBeInTheDocument()
  })

  it('changes a folder icon via the icon picker, and can clear back to default', async () => {
    const store = useNotebookStore.getState()
    const { id } = store.createFolder(null, 'Notes')
    const user = userEvent.setup()
    render(<SectionSidebar />)

    await user.click(screen.getByRole('button', { name: 'Change icon for Notes' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Icon ⭐' }))
    expect(useNotebookStore.getState().folders[id!]?.icon).toBe('⭐')
    expect(screen.getByRole('button', { name: 'Change icon for Notes' })).toHaveTextContent('⭐')

    await user.click(screen.getByRole('button', { name: 'Change icon for Notes' }))
    await user.click(screen.getByRole('menuitem', { name: /Default/ }))
    expect(useNotebookStore.getState().folders[id!]?.icon).toBeNull()
  })

  it('renders the Plugins slot', () => {
    render(<SectionSidebar />)
    expect(screen.getByTestId('plugins-tab')).toBeInTheDocument()
  })
})
