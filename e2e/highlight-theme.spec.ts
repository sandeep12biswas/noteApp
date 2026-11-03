// Issue #6: highlighted text must stay readable in the dark theme — and a
// text colour on highlighted text must survive.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

/** WCAG contrast ratio between a mark's computed text colour and its background. */
async function contrast(mark: Locator): Promise<number> {
  return mark.evaluate((el) => {
    // Through a canvas, so any CSS colour syntax (Tailwind v4 uses oklch()) comes back as sRGB.
    const ctx = document.createElement('canvas').getContext('2d')!
    const parse = (c: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
    }
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const cs = getComputedStyle(el)
    const [a, b] = [lum(parse(cs.color)), lum(parse(cs.backgroundColor))]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  const toggle = page.getByRole('button', { name: /^Theme: / })
  for (let i = 0; i < 3 && !((await toggle.getAttribute('aria-label')) ?? '').includes(theme); i++) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', new RegExp(`Theme: ${theme}`, 'i'))
}

async function pickHighlight(page: Page, color: string) {
  await page.getByRole('button', { name: 'Highlight options' }).click()
  await page.getByRole('menuitemradio', { name: `Highlight ${color}` }).click()
}

/** Sets the theme first: clicking the toggle with an empty segment focused would (rightly) auto-delete it. */
async function openPage(page: Page, theme: 'dark' | 'light') {
  await page.goto('/')
  await setTheme(page, theme)
  await createFolderAndPage(page, 'Hi Folder', 'Hi Page')
  await clickCanvasAt(page, 100, 100)
  await expect(page.locator('[data-testid^="segment-"] .ProseMirror')).toBeFocused()
}

for (const theme of ['dark', 'light'] as const) {
  test(`highlighted text is readable in the ${theme} theme (every preset)`, async ({ page }) => {
    await openPage(page, theme)
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await page.keyboard.type('Readable text')
    await page.keyboard.press('ControlOrMeta+a')
    const presets = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa', '#fbcfe8', '#a5f3fc', '#e5e7eb']
    for (const color of presets) {
      await pickHighlight(page, color)
      const mark = editable.locator('mark').first()
      await expect(mark).toHaveAttribute('data-color', color)
      expect(await contrast(mark), `${color} in ${theme}`).toBeGreaterThanOrEqual(4.5)
    }
  })
}

test('a dark custom highlight gets light text', async ({ page }) => {
  await openPage(page, 'light')
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await page.keyboard.type('On navy')
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Highlight options' }).click()
  await page.getByLabel('Custom highlight').fill('#1e3a8a')
  const mark = editable.locator('mark').first()
  await expect(mark).toBeVisible()
  expect(await contrast(mark)).toBeGreaterThanOrEqual(4.5)
})

test('highlighted text keeps its own text colour, in the dark theme too', async ({ page }) => {
  await openPage(page, 'dark')
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await page.keyboard.type('Red on yellow')
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Text colour options' }).click()
  await page.getByRole('menuitemradio', { name: 'Text colour #dc2626' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  await pickHighlight(page, '#fef08a')
  const mark = editable.locator('mark').first()
  await expect(mark).toHaveCSS('color', 'rgb(220, 38, 38)')
})

test('linear view shows highlights the same way', async ({ page }) => {
  await openPage(page, 'dark')
  await page.keyboard.type('Linear too')
  await page.keyboard.press('ControlOrMeta+a')
  await pickHighlight(page, '#bfdbfe')
  await page.getByRole('button', { name: 'Switch to linear mode' }).click()
  const mark = page.locator('.ProseMirror mark').first()
  await expect(mark).toHaveText('Linear too')
  expect(await contrast(mark)).toBeGreaterThanOrEqual(4.5)
})
