// EXECUTION_PLAN.md Phase 6 E2E: "ink" — DESIGN.md §5.5 Draw mode.
import { expect, test } from '@playwright/test'
import { createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Ink Folder', 'Ink Page')
})

test('the ink layer is inert outside Draw mode and interactive inside it', async ({ page }) => {
  const ink = page.getByTestId('ink-layer')
  await expect(ink).toHaveCSS('pointer-events', 'none')

  await page.getByRole('tab', { name: 'Draw' }).click()
  await expect(ink).toHaveCSS('pointer-events', 'all')
})

test('drawing a stroke actually paints pixels onto the ink canvas', async ({ page }) => {
  await page.getByRole('tab', { name: 'Draw' }).click()
  const ink = page.getByTestId('ink-layer')
  const box = await ink.boundingBox()
  if (!box) throw new Error('ink-layer has no bounding box')

  const isBlank = () => ink.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const data = ctx.getImageData(0, 0, el.width, el.height).data
    return data.every((channel) => channel === 0)
  })
  expect(await isBlank()).toBe(true)

  await page.mouse.move(box.x + 40, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 10 })
  await page.mouse.up()

  expect(await isBlank()).toBe(false)
})

test('switching ink tool and colour updates the ribbon state', async ({ page }) => {
  await page.getByRole('tab', { name: 'Draw' }).click()
  await page.getByRole('button', { name: /eraser/i }).click()
  await expect(page.getByRole('button', { name: /eraser/i })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /^pen$/i }).click()
  const swatch = page.getByRole('button', { name: /^Colour #/ }).nth(1)
  await swatch.click()
  await expect(swatch).toHaveAttribute('aria-pressed', 'true')
})
