import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

describe('PageList', () => {
  it('prompts to select a folder when none is selected', () => {
    render(<PageList />)
    expect(screen.getByText('Select a folder')).toBeInTheDocument()
  })

  it('lists files of the selected folder in natural order', () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    store.createFile(folder.id!, 'Page 10')
    store.createFile(folder.id!, 'Page 2')
    useNotebookStore.setState({ selectedFolderId: folder.id! })

    render(<PageList />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Page 2')
    expect(items[1]).toHaveTextContent('Page 10')
  })

  it('new-page flow: pick an existing folder, then name the file', async () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    const user = userEvent.setup()
    render(<PageList />)

    await user.click(screen.getByRole('button', { name: 'New page' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Existing folder' }), folder.id!)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByRole('textbox', { name: 'File name' }), 'Meeting Notes')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByText('Meeting Notes')).toBeInTheDocument()
    expect(useNotebookStore.getState().selectedFileId).not.toBeNull()
  })

  it('new-page flow: create a new folder, then name the file', async () => {
    const user = userEvent.setup()
    render(<PageList />)

    await user.click(screen.getByRole('button', { name: 'New page' }))
    await user.click(screen.getByRole('radio', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'projects')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByRole('textbox', { name: 'File name' }), 'Roadmap')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const created = Object.values(useNotebookStore.getState().folders)[0]
    expect(created?.name).toBe('Projects')
    expect(screen.getByText('Roadmap')).toBeInTheDocument()
  })

  it('new-page flow: rejects an invalid file name and keeps the dialog open', async () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    const user = userEvent.setup()
    render(<PageList />)

    await user.click(screen.getByRole('button', { name: 'New page' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Existing folder' }), folder.id!)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByRole('textbox', { name: 'File name' }), 'untitled')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert')).toHaveTextContent('capital letter')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('search by name finds a page in a different folder than the selected one', async () => {
    const store = useNotebookStore.getState()
    const a = store.createFolder(null, 'A')
    const b = store.createFolder(null, 'B')
    store.createFile(b.id!, 'Roadmap')
    useNotebookStore.setState({ selectedFolderId: a.id! })

    const user = userEvent.setup()
    render(<PageList />)
    await user.type(screen.getByRole('textbox', { name: 'Search pages' }), 'road')

    expect(screen.getByText('Roadmap')).toBeInTheDocument()
  })

  it('search by content only matches file text, not names', async () => {
    const store = useNotebookStore.getState()
    const folder = store.createFolder(null, 'Notes')
    store.createFile(folder.id!, 'Alpha', 'contains keyword')
    store.createFile(folder.id!, 'Beta', 'nothing here')
    useNotebookStore.setState({ selectedFolderId: folder.id! })

    const user = userEvent.setup()
    render(<PageList />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search mode' }), 'content')
    await user.type(screen.getByRole('textbox', { name: 'Search pages' }), 'keyword')

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })
})
