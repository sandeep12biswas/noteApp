// Ribbon → View → Page colour (issue #11).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageColorButton, DARK_THEME_TITLE } from './PageColorMenu'
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'
import { useEditorBackgroundStore } from '../store/editorBackgroundStore'
import { useThemeStore } from '../store/themeStore'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  useNotebookStore.setState({
    folders: {},
    files: {},
    selectedFolderId: null,
    selectedFileId: null,
    maxFolderDepth: DEFAULT_MAX_FOLDER_DEPTH,
  })
  useEditorBackgroundStore.setState({ defaultBackground: null })
  useThemeStore.setState({ isDark: false })
})

function seedPages() {
  const store = useNotebookStore.getState()
  const folder = store.createFolder(null, 'Notes')
  const a = store.createFile(folder.id!, 'A').id!
  const b = store.createFile(folder.id!, 'B').id!
  store.selectFolder(folder.id!)
  store.selectFile(a)
  return { a, b }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Page colour' }))
  return screen.getByRole('menu', { name: 'Page colour' })
}

describe('Page colour menu', () => {
  it('"This page" colours only the selected page', async () => {
    const { a, b } = seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitemradio', { name: 'This page Sepia' }))

    const files = useNotebookStore.getState().files
    expect(files[a]?.background).toBe('#f8f1e3')
    expect(files[b]?.background).toBeNull()
    expect(useEditorBackgroundStore.getState().defaultBackground).toBeNull()
    expect(screen.getByTestId('page-colour-swatch')).toHaveStyle({ backgroundColor: '#f8f1e3' })
  })

  it('"All pages" sets the default, which a page without its own colour shows', async () => {
    seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitemradio', { name: 'All pages Mint' }))

    expect(useEditorBackgroundStore.getState().defaultBackground).toBe('#ecfdf5')
    expect(screen.getByTestId('page-colour-swatch')).toHaveStyle({ backgroundColor: '#ecfdf5' })
  })

  it('"Use default" clears the page colour and "White" clears the default', async () => {
    const { a } = seedPages()
    useNotebookStore.getState().setFileBackground(a, '#fff1f2')
    useEditorBackgroundStore.getState().setDefaultBackground('#eff6ff')
    const user = userEvent.setup()
    render(<PageColorButton />)

    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Use default' }))
    expect(useNotebookStore.getState().files[a]?.background).toBeNull()
    expect(screen.getByTestId('page-colour-swatch')).toHaveStyle({ backgroundColor: '#eff6ff' })

    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'White' }))
    expect(useEditorBackgroundStore.getState().defaultBackground).toBeNull()
  })

  it('picking the White swatch for all pages stores no default', async () => {
    seedPages()
    useEditorBackgroundStore.getState().setDefaultBackground('#eff6ff')
    const user = userEvent.setup()
    render(<PageColorButton />)
    await user.click(within(await openMenu(user)).getByRole('menuitemradio', { name: 'All pages White' }))
    expect(useEditorBackgroundStore.getState().defaultBackground).toBeNull()
  })

  it('allows a dark custom colour (the text follows it, issue #12)', async () => {
    const { a } = seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    const input = within(menu).getByLabelText('Custom colour for this page')
    fireEvent.change(input, { target: { value: '#1e3a8a' } })
    expect(useNotebookStore.getState().files[a]?.background).toBe('#1e3a8a')
  })

  it('only offers the default section when no page is selected', async () => {
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    expect(within(menu).queryByText('This page')).not.toBeInTheDocument()
    expect(within(menu).getByText('All pages (default)')).toBeInTheDocument()
  })

  it('is disabled in the dark theme', () => {
    seedPages()
    useThemeStore.setState({ isDark: true })
    render(<PageColorButton />)
    const button = screen.getByRole('button', { name: 'Page colour' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', DARK_THEME_TITLE)
  })
})
