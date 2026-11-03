// Issue #9: Format Painter must paint whatever the user selects next —
// by drag, double-click (a word), triple-click (a line), the keyboard, or
// in another segment. Only a drag used to work: the painter read the
// selection at pointerup, before ProseMirror had synced a double/triple-
// click selection, and keyboard selections never triggered it.
import { expect, test, type Page } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

/** Where `word` is on screen. Retried: while the editor re-renders (typing, the spell-check pass), a word's text node can briefly be split. */
async function wordRect(page: Page, word: string): Promise<{ x1: number; x2: number; y: number }> {
  let rect: { x1: number; x2: number; y: number } | null = null
  await expect.poll(async () => (rect = await findWord(page, word)) !== null, { message: `"${word}" on the canvas` }).toBe(true)
  return rect!
}

async function findWord(page: Page, word: string) {
  return page.evaluate((word) => {
    const walker = document.createTreeWalker(document.querySelector('[data-testid="canvas-root"]')!, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const i = t.textContent!.indexOf(word)
      if (i < 0) continue
      const range = document.createRange()
      range.setStart(t, i)
      range.setEnd(t, i + word.length)
      const b = range.getBoundingClientRect()
      return { x1: b.left + 1, x2: b.right - 1, y: b.top + b.height / 2 }
    }
    return null
  }, word)
}

async function dragSelect(page: Page, word: string) {
  const r = await wordRect(page, word)
  await page.mouse.move(r.x1, r.y)
  await page.mouse.down()
  await page.mouse.move(r.x2, r.y, { steps: 5 })
  await page.mouse.up()
}

const editors = (page: Page) => page.locator('[data-testid^="segment-"] .ProseMirror')
const painter = (page: Page) => page.getByRole('button', { name: 'Format Painter' })

/** The text `word` sits in is bold and 24px. */
async function expectPainted(page: Page, word: string) {
  const strong = page.locator('[data-testid="canvas-root"] strong', { hasText: word })
  await expect(strong).toBeVisible()
  await expect(strong).toHaveCSS('font-size', '24px')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Painter Folder', 'Painter Page')
  await clickCanvasAt(page, 100, 100)
  await expect(editors(page).first()).toBeFocused()
  await page.keyboard.type('Styled')
  await page.keyboard.press('Enter')
  await page.keyboard.type('plain words')
  // Format "Styled": bold, 24px.
  await dragSelect(page, 'Styled')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.getByRole('combobox', { name: 'Font size' }).selectOption('24')
  // Pick it up with the painter.
  await dragSelect(page, 'Styled')
  await painter(page).click()
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'true')
})

test('paints a word selected by double-click, then switches off', async ({ page }) => {
  const r = await wordRect(page, 'plain')
  await page.mouse.dblclick((r.x1 + r.x2) / 2, r.y)
  await expectPainted(page, 'plain')
  await expect(editors(page).first().locator('strong', { hasText: 'words' })).toHaveCount(0)
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'false')
})

test('paints a line selected by triple-click', async ({ page }) => {
  const r = await wordRect(page, 'plain')
  await page.mouse.click(r.x1 + 3, r.y, { clickCount: 3 })
  await expectPainted(page, 'plain words')
})

test('paints a drag selection', async ({ page }) => {
  await dragSelect(page, 'plain')
  await expectPainted(page, 'plain')
})

test('paints a selection made with Shift+arrows', async ({ page }) => {
  const r = await wordRect(page, 'plain')
  await page.mouse.click(r.x1, r.y)
  // Shift held while the arrows are tapped; painted when it's released.
  await page.keyboard.down('Shift')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.up('Shift')
  await expectPainted(page, 'plain')
  await expect(editors(page).first().locator('strong', { hasText: 'words' })).toHaveCount(0)
})

test('paints text in a different segment', async ({ page }) => {
  await painter(page).click() // off again, to type the second segment
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'false')
  await clickCanvasAt(page, 100, 400)
  await expect(editors(page).nth(1)).toBeFocused()
  await page.keyboard.type('elsewhere text')
  await dragSelect(page, 'Styled')
  await painter(page).click()
  // The button arms after a short wait (to tell a click from a double-click).
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'true')
  const r = await wordRect(page, 'elsewhere')
  await page.mouse.dblclick((r.x1 + r.x2) / 2, r.y)
  await expectPainted(page, 'elsewhere')
})

test('double-click on the painter keeps it on for several selections', async ({ page }) => {
  await painter(page).click() // off
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'false')
  await dragSelect(page, 'Styled')
  await painter(page).dblclick()
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'true')
  for (const word of ['plain', 'words']) {
    const r = await wordRect(page, word)
    await page.mouse.dblclick((r.x1 + r.x2) / 2, r.y)
    await expectPainted(page, word)
  }
  await expect(painter(page)).toHaveAttribute('aria-pressed', 'true')
})
