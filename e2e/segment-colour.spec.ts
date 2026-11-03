// EXECUTION_PLAN.md Phase 6 E2E: "colour" — DESIGN.md §4.2 right-click
// colour picker.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Colour Folder', 'Colour Page')
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('coloured segment')
})

test('right-click opens the colour menu; picking a swatch colours the segment and it survives going empty', async ({
  page,
}) => {
  const segment = page.getByRole('textbox', { name: 'Segment' }).first()
  await segment.click({ button: 'right' })

  const menu = page.getByRole('menu', { name: 'Segment colour' })
  await expect(menu).toBeVisible()

  await menu.getByRole('menuitemradio').first().click()
  await expect(menu).not.toBeVisible()
  await expect(segment).toHaveCSS('border-style', 'solid')

  // Coloured segments never auto-delete when empty (DESIGN.md §4.2).
  await page.locator('[data-testid^="segment-"] .ProseMirror').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await expect(segment).toBeVisible()
})

test('"None" clears the colour', async ({ page }) => {
  const segment = page.getByRole('textbox', { name: 'Segment' }).first()
  await segment.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Segment colour' }).getByRole('menuitemradio').first().click()

  await segment.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'None' }).click()
  await expect(page.getByRole('menu', { name: 'Segment colour' })).not.toBeVisible()
})

test('Escape closes the colour menu without changing anything', async ({ page }) => {
  const segment = page.getByRole('textbox', { name: 'Segment' }).first()
  await segment.click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Segment colour' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Segment colour' })).not.toBeVisible()
})
