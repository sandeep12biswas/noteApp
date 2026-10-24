// Resizable vertical panels (EXECUTION_PLAN.md Features): drag the handle
// on the right edge of the folder and page panels; the editor takes the
// rest. Limits: 120–480px per panel, and the editor keeps at least 320px.
import { expect, test, type Page } from '@playwright/test'

const width = async (page: Page, testId: string) => Math.round((await page.getByTestId(testId).boundingBox())!.width)

async function drag(page: Page, handleTestId: string, dx: number) {
  const box = (await page.getByTestId(handleTestId).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
})

test('dragging the handles resizes the folder and page panels, within their limits', async ({ page }) => {
  expect(await width(page, 'section-sidebar')).toBe(160)
  expect(await width(page, 'page-list')).toBe(170)

  await drag(page, 'resize-folders', 100)
  expect(await width(page, 'section-sidebar')).toBe(260)

  await drag(page, 'resize-folders', -500) // past the minimum
  expect(await width(page, 'section-sidebar')).toBe(120)

  await drag(page, 'resize-pages', 1000) // past the maximum
  expect(await width(page, 'page-list')).toBe(480)

  // The editor took up the difference and kept well over its minimum.
  const editor = (await page.getByRole('main', { name: 'Editor' }).boundingBox())!
  expect(editor.width).toBeGreaterThanOrEqual(320)
})

test('widths are remembered after a reload, and double-click resets a panel', async ({ page }) => {
  await drag(page, 'resize-folders', 80)
  await drag(page, 'resize-pages', 60)
  await page.reload()
  expect(await width(page, 'section-sidebar')).toBe(240)
  expect(await width(page, 'page-list')).toBe(230)

  await page.getByTestId('resize-folders').dblclick()
  expect(await width(page, 'section-sidebar')).toBe(160)
})

test('a narrow window keeps the editor at its minimum width', async ({ page }) => {
  await drag(page, 'resize-folders', 320) // 480 (max)
  await drag(page, 'resize-pages', 300) // limited by the editor's minimum
  const editor = (await page.getByRole('main', { name: 'Editor' }).boundingBox())!
  expect(Math.round(editor.width)).toBeGreaterThanOrEqual(320)

  await page.setViewportSize({ width: 1000, height: 720 })
  await expect.poll(async () => Math.round((await page.getByRole('main', { name: 'Editor' }).boundingBox())!.width)).toBeGreaterThanOrEqual(320)
})
