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

// Ink is anchored like segments: making the editor narrower (here by
// widening the folder panel) must not move or squash an existing stroke.
// It used to be rescaled to the new width — and then saved that way.
test('a stroke keeps its exact position and size when a side panel is resized', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('tab', { name: 'Draw' }).click()
  const ink = page.getByTestId('ink-layer')
  const box = (await ink.boundingBox())!
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 10 })
  await page.mouse.up()

  /** The stroke's bounding box in CSS px, relative to the ink canvas. */
  const strokeBox = () =>
    ink.evaluate((c: HTMLCanvasElement) => {
      const scale = c.width / c.getBoundingClientRect().width
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          if (d[(y * c.width + x) * 4 + 3]! > 0) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
          }
      return [x0, y0, x1, y1].map((v) => Math.round(v / scale))
    })
  const before = await strokeBox()

  const handle = (await page.getByTestId('resize-folders').boundingBox())!
  await page.mouse.move(handle.x + 2, handle.y + 300)
  await page.mouse.down()
  await page.mouse.move(handle.x + 202, handle.y + 300, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await ink.boundingBox())!.x).toBeGreaterThan(box.x + 150) // editor moved right

  expect(await strokeBox()).toEqual(before)
})
