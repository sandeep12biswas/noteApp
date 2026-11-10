// Tables (issue #37) in the real app: insert from the `/` menu, type into
// cells (Tab to move), edit with the ribbon's table tools, change the
// header colour, and find it all still there after a restart (SQLite).
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

const table = (page: Page) => page.getByTestId('canvas-root').locator('table')

async function cellTexts(page: Page): Promise<string[][]> {
  return table(page).locator('tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent ?? '')))
}

test('insert a table, edit it, and it survives a restart', async () => {
  test.setTimeout(90_000)
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page
  await createFolderAndPage(page, 'Tables', 'Inventory')

  // "/" → Table… → 3 × 2 from the picker.
  await clickCanvasAt(page, 120, 120)
  await page.keyboard.type('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Table…' }).click()
  await page.getByRole('dialog', { name: 'Insert table' }).getByRole('button', { name: '3 by 2 table' }).click()
  await expect(table(page)).toBeVisible()

  // Type the header and first row, moving with Tab.
  await page.keyboard.type('Item')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Qty')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Apples')
  await page.keyboard.press('Tab')
  await page.keyboard.type('3')
  expect(await cellTexts(page)).toEqual([['Item', 'Qty'], ['Apples', '3'], ['', '']])

  // Header: bold, lavender background, readable text.
  const th = table(page).locator('th').first()
  await expect(th).toHaveCSS('font-weight', '700')
  await expect(th).toHaveCSS('background-color', 'rgb(118, 80, 194)')

  // Ribbon table tools act on the table the cursor is in.
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'Insert column right' }).click()
  expect(await cellTexts(page)).toEqual([['Item', 'Qty', ''], ['Apples', '3', ''], ['', '', '']])
  // Delete acts on the column the cursor is in: put it in the new one first.
  await table(page).locator('td').nth(5).click()
  await page.getByRole('button', { name: 'Delete column' }).click()
  expect(await cellTexts(page)).toEqual([['Item', 'Qty'], ['Apples', '3'], ['', '']])
  await page.getByRole('button', { name: 'Header colour' }).click()
  await page.getByRole('menu', { name: 'Header colour' }).getByRole('menuitemradio', { name: /#0f766e/i }).click()
  await expect(th).toHaveCSS('background-color', 'rgb(15, 118, 110)')
  await page.waitForTimeout(600) // segment saves are debounced/fire-and-forget

  // Restart: the table, its text and the header colour are still there.
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Tables', exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Inventory' }).click()
  await expect(table(page)).toBeVisible()
  expect(await cellTexts(page)).toEqual([['Item', 'Qty'], ['Apples', '3'], ['', '']])
  await expect(table(page).locator('th').first()).toHaveCSS('background-color', 'rgb(15, 118, 110)')

  await closeApp(ctx)
})
