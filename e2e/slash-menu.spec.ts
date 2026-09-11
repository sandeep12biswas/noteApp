// EXECUTION_PLAN.md Phase 6 E2E: "slash" — DESIGN.md §4.4 block picker.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Slash Folder', 'Slash Page')
  await clickCanvasAt(page, 100, 100)
})

test('"/" at an empty line opens the block picker; choosing Heading 1 applies it', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')

  const menu = page.getByRole('menu', { name: 'Insert block' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveCount(9) // 9 core block types, DESIGN.md §4.4

  await menu.getByRole('menuitem', { name: 'Heading 1' }).click()
  await expect(menu).not.toBeVisible()
  await expect(editable.locator('h1')).toBeVisible()
})

test('typing past "/" (no longer the sole content of the line) closes the menu', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/x')
  await expect(page.getByRole('menu', { name: 'Insert block' })).not.toBeVisible()
})

test('"/" mid-word (not at an empty line start) never opens the menu', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('abc/')
  await expect(page.getByRole('menu', { name: 'Insert block' })).not.toBeVisible()
})
