// Ribbon → View → Page colour (issue #11).
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageColorButton, DARK_THEME_TITLE } from './PageColorMenu'
import { DEFAULT_MAX_FOLDER_DEPTH, useNotebookStore } from '../store/notebookStore'
import { PAGE_BACKGROUND_SHADES, PAGE_SHADE_NAMES, useEditorBackgroundStore } from '../store/editorBackgroundStore'
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
  useEditorBackgroundStore.setState({ defaultBackground: null, recentBackgrounds: [] })
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

async function applyToAllPages(user: ReturnType<typeof userEvent.setup>, menu: HTMLElement) {
  await user.click(within(menu).getByRole('menuitemradio', { name: 'All pages' }))
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
    await applyToAllPages(user, menu)
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

    const menu = await openMenu(user)
    await applyToAllPages(user, menu)
    await user.click(within(menu).getByRole('menuitem', { name: 'White' }))
    expect(useEditorBackgroundStore.getState().defaultBackground).toBeNull()
  })

  it('picking the White swatch for all pages stores no default', async () => {
    seedPages()
    useEditorBackgroundStore.getState().setDefaultBackground('#eff6ff')
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    await applyToAllPages(user, menu)
    await user.click(within(menu).getByRole('menuitemradio', { name: 'All pages White' }))
    expect(useEditorBackgroundStore.getState().defaultBackground).toBeNull()
  })

  it('offers a darkest-to-lightest shade grid for every hue', async () => {
    const { a } = seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    const grid = within(menu).getByRole('group', { name: 'This page shades' })
    expect(within(grid).getAllByRole('menuitemradio')).toHaveLength(PAGE_BACKGROUND_SHADES.length * PAGE_SHADE_NAMES.length)
    await user.click(within(grid).getByRole('menuitemradio', { name: 'This page Blue darkest' }))
    expect(useNotebookStore.getState().files[a]?.background).toBe('#1e3a8a')
  })

  it('arrow keys move through the shade grid in two dimensions', async () => {
    seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    within(menu).getByRole('menuitemradio', { name: 'This page Red darkest' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(within(menu).getByRole('menuitemradio', { name: 'This page Orange darkest' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'This page Orange dark' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(within(menu).getByRole('menuitemradio', { name: 'This page Grey dark' })).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    // Past the top row: leaves the grid for the last paper swatch.
    expect(within(menu).getByRole('menuitemradio', { name: 'This page Grey' })).toHaveFocus()
  })

  it('the colour wheel applies a typed hex colour, even a dark one (issue #12), and remembers it', async () => {
    const { a } = seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    let menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'More colours…' }))
    expect(within(menu).getByRole('slider', { name: 'Colour wheel' })).toHaveFocus()
    const hex = within(menu).getByRole('textbox', { name: 'Hex colour' })
    await user.clear(hex)
    await user.type(hex, '#1e3a8a')
    expect(screen.getByTestId('colour-wheel-preview')).toHaveStyle({ backgroundColor: '#1e3a8a' })
    expect(useNotebookStore.getState().files[a]?.background).toBeNull() // nothing applies before Apply
    await user.click(within(menu).getByRole('menuitem', { name: 'Apply' }))
    expect(useNotebookStore.getState().files[a]?.background).toBe('#1e3a8a')
    expect(useEditorBackgroundStore.getState().recentBackgrounds).toEqual(['#1e3a8a'])

    menu = await openMenu(user)
    expect(within(menu).getByRole('menuitemradio', { name: 'This page recent #1e3a8a' })).toHaveAttribute('aria-checked', 'true')
  })

  it('the colour wheel rejects an invalid hex and Cancel applies nothing', async () => {
    const { a } = seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'More colours…' }))
    const hex = within(menu).getByRole('textbox', { name: 'Hex colour' })
    await user.clear(hex)
    await user.type(hex, '#12zz')
    expect(hex).toHaveAttribute('aria-invalid', 'true')
    expect(within(menu).getByRole('menuitem', { name: 'Apply' })).toBeDisabled()
    await user.click(within(menu).getByRole('menuitem', { name: 'Cancel' }))
    expect(within(menu).getByRole('menuitem', { name: 'More colours…' })).toBeInTheDocument()
    expect(useNotebookStore.getState().files[a]?.background).toBeNull()
  })

  it('arrow keys on the wheel change hue and saturation', async () => {
    seedPages()
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'More colours…' }))
    const hex = within(menu).getByRole('textbox', { name: 'Hex colour' })
    await user.clear(hex)
    await user.type(hex, '#ff0000')
    within(menu).getByRole('slider', { name: 'Colour wheel' }).focus()
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}') // +60° → yellow
    expect(hex).toHaveValue('#ffff00')
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}') // saturation 100% → 70%
    expect(hex).toHaveValue('#ffff4d')
  })

  it('only offers the default section when no page is selected', async () => {
    const user = userEvent.setup()
    render(<PageColorButton />)
    const menu = await openMenu(user)
    expect(within(menu).queryByRole('group', { name: 'Apply to' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'All pages Sepia' })).toBeInTheDocument()
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
