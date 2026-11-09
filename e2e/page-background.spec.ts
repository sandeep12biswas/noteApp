// Editor background colour (issue #11) and text that follows it (issue #12).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

const NAVY = '#1e3a8a'

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

/** WCAG contrast between an element's text colour and the editor pane's background. */
async function contrastOnPane(page: Page, el: Locator): Promise<number> {
  const pane = await rgb(page.getByTestId('editor-pane'), 'backgroundColor')
  const text = await rgb(el, 'color')
  return page.evaluate(
    ([a, b]) => {
      const lum = (c: string) => {
        const [r, g, bl] = c.match(/\d+/g)!.map((v) => {
          const s = Number(v) / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
      }
      const [x, y] = [lum(a!), lum(b!)]
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    },
    [text, pane],
  )
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

test.describe('on a navy page (issue #12)', () => {
  test.beforeEach(async ({ page }) => {
    await createFolderAndPage(page, 'Navy', 'Night')
    const menu = await openPageColour(page)
    await menu.getByLabel('Custom colour for this page').fill(NAVY)
    await page.keyboard.press('Escape')
    await expect.poll(() => rgb(pane(page), 'backgroundColor')).toBe('rgb(30, 58, 138)')
    await page.getByRole('tab', { name: 'Home' }).click()
  })

  test('the title, timestamp and segment text turn light and readable', async ({ page }) => {
    await clickCanvasAt(page, 100, 100)
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await expect(editable).toBeFocused()
    await page.keyboard.type('Readable on navy')

    expect(await contrastOnPane(page, page.getByRole('textbox', { name: 'Page title' }))).toBeGreaterThanOrEqual(4.5)
    expect(await contrastOnPane(page, editable.locator('p').first())).toBeGreaterThanOrEqual(4.5)
    const timestamp = pane(page).locator('p.editor-muted').first()
    expect(await contrastOnPane(page, timestamp)).toBeGreaterThanOrEqual(4.5)
  })

  test('the Text colour menu suggests readable colours and dims hard-to-read ones', async ({ page }) => {
    await page.getByRole('button', { name: 'Text colour options' }).click()
    const menu = page.getByRole('menu', { name: 'Text colour' })
    await expect(menu.getByText('Suggested')).toBeVisible()
    await expect(menu.getByRole('group', { name: 'Text colour suggested' }).getByRole('menuitemradio')).toHaveCount(4)
    await expect(menu.getByRole('menuitemradio', { name: 'Text colour #2563eb' })).toHaveAttribute('data-low-contrast', 'true')
  })

  test('dark-blue text raises the notice; Adjust fixes it, Undo restores it, Keep hides it', async ({ page }) => {
    await clickCanvasAt(page, 100, 100)
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await expect(editable).toBeFocused()
    await page.keyboard.type('Blue words')
    await page.keyboard.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Text colour options' }).click()
    await page.getByRole('menuitemradio', { name: 'Text colour #2563eb' }).click()

    const notice = page.getByTestId('contrast-notice')
    await expect(notice).toContainText('1 coloured passage is hard to read on this background')
    const span = editable.locator('span[style*="color"]').first()
    expect(await contrastOnPane(page, span)).toBeLessThan(4.5)

    await notice.getByRole('button', { name: 'Adjust' }).click()
    await expect(notice).toBeHidden()
    expect(await contrastOnPane(page, span)).toBeGreaterThanOrEqual(4.5)

    await editable.focus()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(notice).toBeVisible()
    expect(await contrastOnPane(page, span)).toBeLessThan(4.5)

    await notice.getByRole('button', { name: 'Keep' }).click()
    await expect(notice).toBeHidden()
    await page.reload()
    // Client-only state in this suite: the page itself is gone after a
    // reload, but the "kept" choice is in localStorage.
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('flownote:contrast-kept:')))).toBe(true)
  })

  test('linear view gets the same readable text', async ({ page }) => {
    await clickCanvasAt(page, 100, 100)
    await page.keyboard.type('Linear on navy')
    await page.getByRole('button', { name: 'Switch to linear mode' }).click()
    const paragraph = page.locator('.ProseMirror p').first()
    await expect(paragraph).toHaveText('Linear on navy')
    expect(await contrastOnPane(page, paragraph)).toBeGreaterThanOrEqual(4.5)
  })
})
