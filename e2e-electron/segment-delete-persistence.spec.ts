// "Delete segment" with undo (issue #29) against real SQLite storage. The
// storage delete is deferred until the undo window ends (it also removes
// attachment files), so: an undone delete must leave the segment saved, an
// expired one must remove it, and closing the app mid-window must commit it.
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

const segments = (page: Page) => page.getByRole('textbox', { name: 'Segment' })

async function selectPage(page: Page, folder: string, file: string) {
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: folder, exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: file }).click()
}

async function addSegment(page: Page, y: number, text: string) {
  await clickCanvasAt(page, 100, y)
  await page.keyboard.type(text)
  await page.waitForTimeout(400) // segment saves are fire-and-forget
}

async function deleteSegment(page: Page, text: string) {
  await segments(page).filter({ hasText: text }).click({ button: 'right' })
  await page.getByRole('menu', { name: 'Segment colour' }).getByRole('menuitem', { name: 'Delete segment' }).click()
  await expect(segments(page).filter({ hasText: text })).toHaveCount(0)
}

async function restart(ctx: LaunchedApp): Promise<LaunchedApp> {
  await ctx.app.close()
  const next = await launchApp({ userDataDir: ctx.userDataDir })
  await selectPage(next.page, 'Deletes', 'Page')
  return next
}

test('undone, expired and closed-mid-window deletions are stored correctly', async () => {
  test.setTimeout(120_000) // two launches plus an 8 s undo window
  let ctx = await launchApp()
  await createFolderAndPage(ctx.page, 'Deletes', 'Page')
  await addSegment(ctx.page, 100, 'undone')
  await addSegment(ctx.page, 300, 'expired')
  await addSegment(ctx.page, 500, 'closed mid-window')
  await ctx.page.locator('body').click({ position: { x: 5, y: 5 } })

  // Undone: stays saved.
  await deleteSegment(ctx.page, 'undone')
  await ctx.page.getByTestId('undo-delete-toast').getByRole('button', { name: 'Undo' }).click()
  // Expired: deleted from storage once the toast times out.
  await deleteSegment(ctx.page, 'expired')
  await expect(ctx.page.getByTestId('undo-delete-toast')).toBeHidden({ timeout: 12_000 })
  await ctx.page.waitForTimeout(300)
  // Closed mid-window: closing the app commits it.
  await deleteSegment(ctx.page, 'closed mid-window')
  await expect(ctx.page.getByTestId('undo-delete-toast')).toBeVisible()

  ctx = await restart(ctx)
  await expect(segments(ctx.page).filter({ hasText: 'undone' })).toHaveCount(1)
  await ctx.page.waitForTimeout(500)
  await expect(segments(ctx.page).filter({ hasText: 'expired' })).toHaveCount(0)
  await expect(segments(ctx.page).filter({ hasText: 'closed mid-window' })).toHaveCount(0)

  await closeApp(ctx)
})
