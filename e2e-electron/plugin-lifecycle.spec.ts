// EXECUTION_PLAN.md Phase 7 "Plugin system E2E tests" — the full DESIGN.md
// §9.7 step 8 cycle against the real Electron shell + Rust sidecar + the
// spreadsheet reference plugin: install -> block type appears in the slash
// menu -> insert -> enter data -> verify it persists -> disable (placeholder
// shown, data untouched) -> re-enable (restored) -> uninstall (placeholder
// persists). One serial spec, one Electron process, one SQLite file for the
// whole file — see `helpers.ts` for why (a real desktop app + custom
// `flownote-plugin://` protocol, not the browser-only top-level e2e/ suite).
//
// Prerequisites (not run here — see e2e-electron/README.md): the frontend,
// electron, sidecar, SDK and spreadsheet plugin builds must all be current,
// and the plugin must already be installed under
// packages/frontend/public/plugins/com.sandeep.spreadsheet (this suite
// installs it into the *app's plugin registry*, not onto disk — see the
// spreadsheet plugin's own README for that one-time build/copy step).
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import {
  clickCanvasAt,
  closeApp,
  createFolderAndPage,
  waitForGridFrame,
  launchApp,
  readGridCell,
  setGridCell,
  SPREADSHEET_MANIFEST,
  type LaunchedApp,
} from './helpers'

test.describe.serial('plugin lifecycle: install, use, disable/re-enable, uninstall', () => {
  let ctx: LaunchedApp
  let page: Page

  test.beforeAll(async () => {
    ctx = await launchApp()
    page = ctx.page
  })

  test.afterAll(async () => {
    await closeApp(ctx)
  })

  test('a fresh app has no plugins installed', async () => {
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
    await expect(page.getByTestId('plugin-manager-ui')).toBeVisible()
    await expect(page.getByText('No plugins installed.')).toBeVisible()
  })

  test('installs the spreadsheet plugin from its manifest', async () => {
    await page.getByRole('button', { name: 'Install…' }).click()
    await page.getByRole('textbox', { name: 'Plugin manifest JSON' }).fill(SPREADSHEET_MANIFEST)
    await page.getByRole('button', { name: 'Install', exact: true }).click()

    const row = page.getByRole('list', { name: 'Installed plugins' }).getByRole('listitem').filter({ hasText: 'Spreadsheet' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('checkbox', { name: 'Disable Spreadsheet' })).toBeChecked()
  })

  test('/sheet inserts a working spreadsheet block from the slash menu', async () => {
    // Back to the notebook view, create somewhere to type.
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
    await createFolderAndPage(page, 'Notes', 'Budget')

    await clickCanvasAt(page, 100, 100)
    const segment = page.getByTestId(/^segment-/).first()
    await segment.click()
    await page.keyboard.type('/')

    const menu = page.getByRole('menu', { name: 'Insert block' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Spreadsheet' }).click()

    const block = page.getByTestId(/^plugin-block-/).first()
    await expect(block.locator('iframe')).toBeVisible()

    // Driven via `Frame.evaluate` rather than `frameLocator(...).fill()` —
    // see `waitForGridFrame`'s doc comment: locator actions against this
    // sandboxed cross-origin OOPIF were found to hang unreliably here.
    const grid = await waitForGridFrame(page)
    await setGridCell(grid, 0, 0, '42')
    await expect.poll(() => readGridCell(grid, 0, 0)).toBe('42')
  })

  test('the entered value survives navigating away and back (real SQLite round-trip)', async () => {
    await createFolderAndPage(page, 'Scratch', 'Other')
    await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes' }).click()
    await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Budget' }).click()

    await page.getByTestId(/^plugin-block-/).first().locator('iframe').waitFor()
    const grid = await waitForGridFrame(page)
    expect(await readGridCell(grid, 0, 0)).toBe('42')
  })

  test('disabling the plugin shows the "Plugin inactive" placeholder, data untouched', async () => {
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
    await page.getByRole('checkbox', { name: 'Disable Spreadsheet' }).uncheck()
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()

    const block = page.getByTestId(/^plugin-block-/).first()
    await expect(block).toHaveText('Plugin inactive')
  })

  test('re-enabling restores the block with its data intact', async () => {
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
    await page.getByRole('checkbox', { name: 'Enable Spreadsheet' }).check()
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()

    await page.getByTestId(/^plugin-block-/).first().locator('iframe').waitFor()
    const grid = await waitForGridFrame(page)
    expect(await readGridCell(grid, 0, 0)).toBe('42')
  })

  test('uninstalling leaves the placeholder in place (fallback, no crash)', async () => {
    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
    await page.getByRole('button', { name: 'Uninstall Spreadsheet' }).click()
    await page.getByRole('button', { name: 'Yes' }).click()
    await expect(page.getByText('No plugins installed.')).toBeVisible()

    await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
    const block = page.getByTestId(/^plugin-block-/).first()
    await expect(block).toHaveText('Plugin inactive')
  })
})
