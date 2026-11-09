// Sync (steps S5–S7) against the real app: two Electron instances, each with
// its own database (separate user-data dirs) and its own sidecar running
// the sync service, set up through the Sync settings dialog to sync through
// one shared folder — the "folder on this computer" target, which needs no
// cloud account. A third instance with the wrong passphrase is refused.
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

const PASSPHRASE = 'correct horse battery staple'

async function openSyncSettings(page: Page) {
  await page.getByRole('tab', { name: 'View' }).click()
  await page.getByRole('button', { name: 'Sync settings' }).click()
  return page.getByRole('dialog', { name: 'Sync settings' })
}

/** Chooses the shared folder and enters the passphrase; returns the dialog, still open. */
async function setUpSync(page: Page, folder: string, passphrase: string) {
  const dialog = await openSyncSettings(page)
  await dialog.getByRole('radio', { name: /A folder on this computer/ }).check()
  await dialog.getByLabel('Sync folder path').fill(folder)
  await dialog.getByRole('button', { name: 'Continue' }).click()
  const pass = dialog.getByRole('textbox', { name: 'Passphrase', exact: true })
  await expect(pass).toBeVisible()
  await pass.fill(passphrase)
  const confirm = dialog.getByLabel('Confirm passphrase')
  if (await confirm.isVisible()) await confirm.fill(passphrase) // first device: creating the vault
  await dialog.getByRole('button', { name: 'Start syncing' }).click()
  return dialog
}

async function openPage(page: Page, folder: string, file: string) {
  await expect(page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: folder, exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: folder, exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: file }).click()
}

test('two devices sync notes through a shared folder, set up from the Sync settings dialog', async () => {
  test.setTimeout(120_000)
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-sync-e2e-'))
  const apps: LaunchedApp[] = []
  try {
    // Device A: a note, then sync set up as the first device.
    const a = await launchApp()
    apps.push(a)
    await createFolderAndPage(a.page, 'Shared', 'Plans')
    await clickCanvasAt(a.page, 120, 120)
    await a.page.keyboard.type('written on A')
    await a.page.waitForTimeout(500) // saves are fire-and-forget
    const dialogA = await setUpSync(a.page, shared, PASSPHRASE)
    await expect(dialogA.getByRole('status')).toContainText('Up to date', { timeout: 30_000 })
    await a.page.keyboard.press('Escape')
    await expect(a.page.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'idle')
    expect(fs.existsSync(path.join(shared, 'vault.json'))).toBe(true)

    // Device B joins with the same passphrase (asked once: the vault exists)
    // and gets A's note without a reload.
    const b = await launchApp()
    apps.push(b)
    const dialogB = await setUpSync(b.page, shared, PASSPHRASE)
    await expect(dialogB.getByRole('status')).toContainText('Up to date', { timeout: 30_000 })
    await expect(dialogB.getByText(/Other devices:/)).toBeVisible()
    await b.page.keyboard.press('Escape')
    await openPage(b.page, 'Shared', 'Plans')
    const onB = b.page.getByText('written on A')
    await expect(onB).toBeVisible({ timeout: 20_000 })

    // An edit on B reaches A's open page (B uploads by itself a few seconds
    // after the edit; A is nudged with "Sync now" from its status bar).
    await onB.click()
    await b.page.keyboard.press('End')
    await b.page.keyboard.type(', edited on B')
    await expect
      .poll(
        async () => {
          await a.page.getByTestId('sync-indicator').click()
          const dialog = a.page.getByRole('dialog', { name: 'Sync settings' })
          const syncNow = dialog.getByRole('button', { name: 'Sync now' })
          if (await syncNow.isEnabled()) await syncNow.click()
          await a.page.keyboard.press('Escape')
          return a.page.getByText('written on A, edited on B').count()
        },
        { timeout: 45_000, intervals: [2_000] },
      )
      .toBe(1)

    // A third device with the wrong passphrase is told so, and joins nothing.
    const c = await launchApp()
    apps.push(c)
    const dialogC = await setUpSync(c.page, shared, 'not the passphrase')
    await expect(dialogC.getByRole('alert')).toContainText('Wrong passphrase', { timeout: 30_000 })
    await expect(dialogC.getByRole('textbox', { name: 'Passphrase', exact: true })).toBeVisible()
  } finally {
    for (const app of apps) await closeApp(app)
    fs.rmSync(shared, { recursive: true, force: true })
  }
})
