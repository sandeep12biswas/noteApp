// Issue #11 against the real app: a page's own background colour is saved
// with the page (SQLite, V11 migration) and the default is a per-device
// preference (localStorage) — both must survive a full restart.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from 'playwright-core'
import { closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor)
}

async function setLightTheme(page: Page) {
  const toggle = page.getByRole('button', { name: /^Theme: / })
  for (let i = 0; i < 3 && !((await toggle.getAttribute('aria-label')) ?? '').includes('light'); i++) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', /Theme: light/i)
}

async function openPageColour(page: Page) {
  await page.getByRole('tab', { name: 'View' }).click()
  await page.getByRole('button', { name: 'Page colour' }).click()
  return page.getByRole('menu', { name: 'Page colour' })
}

async function selectPage(page: Page, folder: string, file: string) {
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: folder, exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: file }).click()
}

test('a page colour and the default survive a restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page
  await setLightTheme(page)

  await createFolderAndPage(page, 'Own', 'Coloured')
  await (await openPageColour(page)).getByRole('menuitemradio', { name: 'This page Mint' }).click()
  await createFolderAndPage(page, 'Plain', 'Default')
  await (await openPageColour(page)).getByRole('menuitemradio', { name: 'All pages Sepia' }).click()
  await page.waitForTimeout(300) // set_page_background is fire-and-forget

  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page
  const pane = page.getByTestId('editor-pane')

  await selectPage(page, 'Own', 'Coloured')
  await expect.poll(() => backgroundOf(pane)).toBe('rgb(236, 253, 245)')
  await selectPage(page, 'Plain', 'Default')
  await expect.poll(() => backgroundOf(pane)).toBe('rgb(248, 241, 227)')

  await closeApp(ctx)
})
