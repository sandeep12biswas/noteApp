// Editor background colour (issue #11).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createFolderAndPage } from './helpers'

/** sRGB of any CSS colour (Tailwind v4 uses oklch()), via a canvas. */
async function rgb(locator: Locator, property: 'color' | 'backgroundColor'): Promise<string> {
  return locator.evaluate((el, prop) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el)[prop]
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a === 0 ? 'transparent' : `rgb(${r}, ${g}, ${b})`
  }, property)
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  const toggle = page.getByRole('button', { name: /^Theme: / })
  for (let i = 0; i < 3 && !((await toggle.getAttribute('aria-label')) ?? '').includes(theme); i++) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', new RegExp(`Theme: ${theme}`, 'i'))
}

async function addPage(page: Page, folderName: string, pageName: string) {
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('radio', { name: 'Existing folder' }).check()
  await page.getByRole('combobox', { name: 'Existing folder' }).selectOption({ label: folderName })
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill(pageName)
  await page.getByRole('button', { name: 'Create' }).click()
}

async function openPageColour(page: Page) {
  await page.getByRole('tab', { name: 'View' }).click()
  await page.getByRole('button', { name: 'Page colour' }).click()
  return page.getByRole('menu', { name: 'Page colour' })
}

const pane = (page: Page) => page.getByTestId('editor-pane')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await setTheme(page, 'light')
})

test('a default colours every page; a page colour only its own page; Use default reverts it', async ({ page }) => {
  await createFolderAndPage(page, 'Colours', 'First')
  await addPage(page, 'Colours', 'Second')

  // Default for all pages.
  await (await openPageColour(page)).getByRole('menuitemradio', { name: 'All pages Sepia' }).click()
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(248, 241, 227)')
  await page.getByRole('button', { name: 'First' }).click()
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(248, 241, 227)')

  // Own colour for First only.
  await (await openPageColour(page)).getByRole('menuitemradio', { name: 'This page Mint' }).click()
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(236, 253, 245)')
  await page.getByRole('button', { name: 'Second' }).click()
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(248, 241, 227)')

  await page.getByRole('button', { name: 'First' }).click()
  await (await openPageColour(page)).getByRole('menuitem', { name: 'Use default' }).click()
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(248, 241, 227)')
})

test('the colour covers the title header and the writing area, in canvas and linear mode', async ({ page }) => {
  await createFolderAndPage(page, 'Cover', 'Page')
  await (await openPageColour(page)).getByRole('menuitemradio', { name: 'This page Lavender' }).click()
  const lavender = 'rgb(245, 243, 255)'
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe(lavender)
  // Nothing inside the pane paints over it.
  for (const inner of [page.getByRole('textbox', { name: 'Page title' }), page.getByTestId('canvas-root')]) {
    expect(await rgb(inner, 'backgroundColor')).toBe('transparent')
  }
  await page.getByRole('button', { name: 'Switch to linear mode' }).click()
  await expect(page.getByTestId('linear-root')).toBeVisible()
  expect(await rgb(page.getByTestId('linear-root'), 'backgroundColor')).toBe('transparent')
  expect(await rgb(pane(page), 'backgroundColor')).toBe(lavender)
})

test('the dark theme keeps its dark pane and disables the button; light brings the colour back', async ({ page }) => {
  await createFolderAndPage(page, 'Themes', 'Page')
  await (await openPageColour(page)).getByRole('menuitemradio', { name: 'This page Rose' }).click()
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(255, 241, 242)')

  await setTheme(page, 'dark')
  await expect(page.getByRole('button', { name: 'Page colour' })).toBeDisabled()
  expect(await rgb(pane(page), 'backgroundColor')).toBe('transparent') // the shell's dark background shows
  await expect.poll(() => rgb(page.getByRole('textbox', { name: 'Page title' }), 'color')).not.toBe('rgb(17, 24, 39)')

  await setTheme(page, 'light')
  await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(255, 241, 242)')
  await expect(page.getByRole('button', { name: 'Page colour' })).toBeEnabled()
})
