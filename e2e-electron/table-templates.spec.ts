// Table templates (issue #38) in the real app, through the real SQLite
// store: save a table as a template (with and without contents), restart,
// insert it on another page from Insert ▸ Table and from `/table <name>`,
// then rename/delete templates without touching tables already in notes.
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

const tables = (page: Page) => page.getByTestId('canvas-root').locator('table')

async function rowsOf(page: Page, index: number): Promise<string[][]> {
  return tables(page).nth(index).locator('tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent ?? '')))
}

async function saveAsTemplate(page: Page, name: string, includeContents: boolean) {
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'Save as template…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await dialog.getByRole('textbox', { name: 'Template name' }).fill(name)
  if (includeContents) await dialog.getByRole('checkbox', { name: /Include cell contents/ }).check()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

test('save a table as a template, restart, and reuse it on another page', async () => {
  test.setTimeout(120_000)
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page
  await createFolderAndPage(page, 'Shop', 'Monday')

  // A 2 × 2 table with a teal header.
  await clickCanvasAt(page, 120, 100)
  await page.keyboard.type('/')
  await page.getByRole('menuitem', { name: 'Table…' }).click()
  await page.getByRole('button', { name: '2 by 2 table' }).click()
  for (const t of ['Item', 'Qty', 'Apples']) {
    await page.keyboard.type(t)
    await page.keyboard.press('Tab')
  }
  await page.keyboard.type('3')
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'Header colour' }).click()
  await page.getByRole('menu', { name: 'Header colour' }).getByRole('menuitemradio', { name: /#0f766e/i }).click()

  await saveAsTemplate(page, 'Groceries', false)
  await tables(page).locator('td').last().click()
  await saveAsTemplate(page, 'Full list', true)

  // Overwriting asks first.
  await tables(page).locator('td').last().click()
  await page.getByRole('button', { name: 'Save as template…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('groceries')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toContainText('“Groceries” already exists. Replace it?')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Restart; templates are still there and work on a different page.
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page
  await createFolderAndPage(page, 'Shop 2', 'Tuesday')

  await clickCanvasAt(page, 120, 100)
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'Insert table' }).click()
  await page.getByRole('group', { name: 'From template' }).getByRole('button', { name: 'Insert template Groceries' }).click()
  await expect(tables(page)).toHaveCount(1)
  expect(await rowsOf(page, 0)).toEqual([['Item', 'Qty'], ['', '']]) // structure + header only
  await expect(tables(page).first().locator('th').first()).toHaveCSS('background-color', 'rgb(15, 118, 110)')

  // `/table <name>` in a new segment filters templates; Enter inserts the match.
  await clickCanvasAt(page, 120, 380)
  await page.keyboard.type('/table ful')
  const menu = page.getByRole('menu', { name: 'Table templates' })
  await expect(menu.getByRole('menuitem')).toHaveText([/Full list/])
  await page.keyboard.press('Enter')
  await expect(tables(page)).toHaveCount(2)
  expect(await rowsOf(page, 1)).toEqual([['Item', 'Qty'], ['Apples', '3']]) // with contents

  // Rename and delete templates: tables already in the note don't change.
  await page.getByRole('button', { name: 'Manage templates…' }).click()
  const manager = page.getByRole('dialog', { name: 'Table templates' })
  await manager.getByRole('button', { name: 'Rename Groceries' }).click()
  await manager.getByRole('textbox', { name: 'New name for Groceries' }).fill('Shopping')
  await manager.getByRole('textbox', { name: 'New name for Groceries' }).press('Enter')
  await expect(manager.getByRole('listitem', { name: 'Template Shopping' })).toBeVisible()
  await manager.getByRole('button', { name: 'Delete Full list' }).click()
  await manager.getByRole('button', { name: 'Delete “Full list”?' }).click()
  await expect(manager.getByRole('listitem', { name: 'Template Full list' })).toHaveCount(0)
  await manager.getByRole('button', { name: 'Close' }).click()
  expect(await rowsOf(page, 0)).toEqual([['Item', 'Qty'], ['', '']])
  expect(await rowsOf(page, 1)).toEqual([['Item', 'Qty'], ['Apples', '3']])

  await closeApp(ctx)
})
