// A value typed into a plugin block must survive a full app restart —
// i.e. it really reached SQLite, not just the in-memory editor state.
// plugin-lifecycle.spec.ts only switches pages within one running app.
// The value travels: grid <input> change -> block.updateAttrs() ->
// postMessage -> the plugin node's attrs in the TipTap doc -> the segment's
// content -> saveSegment -> SQLite (plus a parallel plugin.storage copy).
import { expect, test } from '@playwright/test'
import {
  clickCanvasAt,
  closeApp,
  createFolderAndPage,
  launchApp,
  readGridCell,
  setGridCell,
  SPREADSHEET_MANIFEST,
  waitForGridFrame,
  type LaunchedApp,
} from './helpers'

test('a spreadsheet value survives a full app restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page

  await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
  await page.getByRole('button', { name: 'Install…' }).click()
  await page.getByRole('textbox', { name: 'Plugin manifest JSON' }).fill(SPREADSHEET_MANIFEST)
  await page.getByRole('button', { name: 'Install', exact: true }).click()
  await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()

  await createFolderAndPage(page, 'Notes', 'Budget')
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Spreadsheet' }).click()
  const grid = await waitForGridFrame(page)
  await expect.poll(() => grid.evaluate(() => document.querySelectorAll('table input').length)).toBeGreaterThan(0)
  await setGridCell(grid, 1, 2, 'quarterly 42')

  // Leave the page and come back: the value must come back from the saved
  // segment, which means the save went through before we restart.
  await createFolderAndPage(page, 'Scratch', 'Other')
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Budget' }).click()
  await expect.poll(async () => readGridCell(await waitForGridFrame(page), 1, 2)).toBe('quarterly 42')

  // Restart against the same database (app.close(), not closeApp — see ink-layer-persistence.spec.ts).
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Budget' }).click()
  await expect.poll(async () => readGridCell(await waitForGridFrame(page), 1, 2)).toBe('quarterly 42')

  await closeApp(ctx)
})
