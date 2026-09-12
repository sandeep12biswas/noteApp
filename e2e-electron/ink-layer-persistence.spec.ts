// EXECUTION_PLAN.md Phase 2 "Ink canvas layer" follow-up: ink_layer
// persistence (V4 migration + save_ink_layer/get_ink_layer, both shells).
// Same real-Electron-app rationale as plugin-lifecycle.spec.ts — this needs
// a real SQLite file and a real app restart, not the browser-only e2e/
// suite. Verifies a stroke survives switching pages away and back, and a
// full app restart against the same on-disk database.
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

/**
 * The canvas's own PNG encoding length as a cheap stand-in for "has a
 * stroke been drawn" — a blank canvas encodes to a small, stable length; a
 * drawn one is reliably larger. Not compared for exact equality across a
 * reload/restart: `InkLayer`'s `ResizeObserver`-driven resize can redraw
 * the loaded image at a very slightly different container size (e.g. a
 * scrollbar appearing/disappearing), changing the PNG's exact byte count
 * without changing whether the stroke round-tripped.
 */
async function inkLayerLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="ink-layer"]') as HTMLCanvasElement | null
    return canvas ? canvas.toDataURL('image/png').length : 0
  })
}

async function drawAStroke(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Draw' }).click()
  const inkLayer = page.getByTestId('ink-layer')
  const box = await inkLayer.boundingBox()
  if (!box) throw new Error('ink-layer has no bounding box')
  await page.mouse.move(box.x + 50, box.y + 50)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 120, { steps: 10 })
  await page.mouse.up()
  // save_ink_layer fires on pointerup (InkLayer.tsx's endStroke -> persist()) — give the fire-and-forget IPC call a moment to land before the next step reads it back.
  await page.waitForTimeout(300)
}

test('a stroke survives switching pages away and back, and a full app restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page

  await createFolderAndPage(page, 'Notes', 'Sketch')
  await drawAStroke(page)
  const drawnLength = await inkLayerLength(page)
  expect(drawnLength).toBeGreaterThan(0)

  await createFolderAndPage(page, 'Other', 'Blank')
  const blankLength = await inkLayerLength(page)
  expect(blankLength).toBeLessThan(drawnLength)

  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes' }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Sketch' }).click()
  await page.waitForTimeout(300)
  expect(await inkLayerLength(page)).toBeGreaterThan(blankLength)

  // Restart against the *same* on-disk database — app.close() directly
  // (not closeApp, which would delete the directory) so launchApp's
  // `userDataDir` option can reopen it.
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page

  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes' }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Sketch' }).click()
  await page.waitForTimeout(300)
  expect(await inkLayerLength(page)).toBeGreaterThan(blankLength)

  await closeApp(ctx)
})
