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

test('the menu offers shades and the colour wheel, and stays inside the window', async ({ page }) => {
  const segment = page.getByRole('textbox', { name: 'Segment' }).first()
  await segment.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Segment colour' })
  await menu.getByRole('menuitemradio', { name: 'Colour Indigo darker' }).click()
  await expect(segment).toHaveCSS('border-top-color', 'rgb(55, 48, 163)')

  await segment.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'More colours…' }).click()
  await menu.getByRole('textbox', { name: 'Hex colour' }).fill('#b45309')
  await menu.getByRole('menuitem', { name: 'Apply' }).click()
  await expect(segment).toHaveCSS('border-top-color', 'rgb(180, 83, 9)')
  await expect(segment).toHaveCSS('background-color', 'rgba(180, 83, 9, 0.08)')

  // Opened near the bottom-right corner, the menu shifts to stay fully visible.
  const viewport = page.viewportSize()!
  await page.evaluate(([x, y]) => {
    const el = document.querySelector('[data-testid^="segment-"] .ProseMirror')!
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }))
  }, [viewport.width - 5, viewport.height - 5])
  const box = (await menu.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  await expect(menu.getByRole('menuitemradio', { name: 'Colour recent #b45309' })).toBeVisible()
})
