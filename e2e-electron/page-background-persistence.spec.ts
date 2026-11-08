// Issues #11 and #12 against the real app: a page's own background colour
// is saved with the page (SQLite, V11 migration) and the default is a
// per-device preference (localStorage) — both must survive a full restart,
// and so must colours fixed by the contrast notice's Adjust (ordinary text
// edits saved through the normal path).
import { expect, test } from '@playwright/test'
import type { Locator, Page } from 'playwright-core'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

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

test('colours fixed with Adjust survive a restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page
  await setLightTheme(page)

  await createFolderAndPage(page, 'Navy', 'Night')
  const menu = await openPageColour(page)
  await menu.getByLabel('Custom colour for this page').fill('#1e3a8a')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Home' }).click()

  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('Blue words')
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Text colour options' }).click()
  await page.getByRole('menuitemradio', { name: 'Text colour #2563eb' }).click()

  const notice = page.getByTestId('contrast-notice')
  await notice.getByRole('button', { name: 'Adjust' }).click()
  await expect(notice).toBeHidden()
  const span = page.locator('[data-testid^="segment-"] .ProseMirror span[style*="color"]').first()
  const adjusted = await span.evaluate((el) => el.style.color)
  expect(adjusted).not.toBe('rgb(37, 99, 235)')
  await page.waitForTimeout(800) // segment saves are debounced

  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page
  await selectPage(page, 'Navy', 'Night')

  const restored = page.locator('[data-testid^="segment-"] .ProseMirror span[style*="color"]').first()
  await expect(restored).toHaveText('Blue words')
  expect(await restored.evaluate((el) => el.style.color)).toBe(adjusted)
  await page.waitForTimeout(500)
  await expect(page.getByTestId('contrast-notice')).toBeHidden()

  await closeApp(ctx)
})
