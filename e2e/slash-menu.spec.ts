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

// Issue #4: clicking a menu item used to move focus to the item, and
// TipTap's `focus()` only hands it back a frame later — so keystrokes typed
// straight after the click went to a button that was about to unmount and
// were lost ("Action items" -> "on items"). Typed with no wait on purpose;
// this is a timing bug, so CI-style single passes prove little — run with
// `--repeat-each` when touching this.
test('text typed immediately after choosing a block type is not lost', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Heading 1' }).click()
  await page.keyboard.type('Action items')
  await expect(editable.locator('h1')).toHaveText('Action items')
})

// Same bug via the keyboard: Tab moves focus into the menu, so the editor
// is unfocused when Enter picks an item (SegmentHost's `refocusEditorNow`).
test('text typed immediately after picking a block type with the keyboard is not lost', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')
  await page.keyboard.press('Tab') // into the menu, on "Text"
  await page.keyboard.press('ArrowDown') // "Heading 1"
  await page.keyboard.press('Enter')
  await page.keyboard.type('Action items')
  await expect(editable.locator('h1')).toHaveText('Action items')
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
