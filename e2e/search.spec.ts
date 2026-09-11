// EXECUTION_PLAN.md Phase 6 E2E: "search" — DESIGN.md §2.2 filename/content
// search. No IPCAdapter in this browser-only suite (see playwright.config.ts),
// so this exercises the local (in-memory) search path, not the backend FTS5
// one — that's `ipc.search()`, covered by the Rust `protocol.rs` tests and
// `PageList.test.tsx`'s "backed by ipc.search" suite instead.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('search by name finds a page in a different folder than the selected one', async ({ page }) => {
  await createFolderAndPage(page, 'Folder A', 'Alpha Notes')
  await createFolderAndPage(page, 'Folder B', 'Roadmap')

  await page.getByRole('textbox', { name: 'Search pages' }).fill('road')
  await expect(page.getByRole('list', { name: 'Search results' }).getByText('Roadmap')).toBeVisible()
  await expect(page.getByText('Alpha Notes')).not.toBeVisible()
})

test('search by content only matches text typed into a segment, not the page title', async ({ page }) => {
  await createFolderAndPage(page, 'Search Folder', 'Untitled Page')
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('a very findable phrase')
  await page.locator('body').click({ position: { x: 5, y: 5 } })

  await page.getByRole('combobox', { name: 'Search mode' }).selectOption('content')
  await page.getByRole('textbox', { name: 'Search pages' }).fill('findable')

  await expect(page.getByRole('list', { name: 'Search results' }).getByText('Untitled Page')).toBeVisible()
})

test('an empty query shows the normal file list again, not "No matches"', async ({ page }) => {
  await createFolderAndPage(page, 'Toggle Folder', 'Toggle Page')
  const search = page.getByRole('textbox', { name: 'Search pages' })
  await search.fill('nothing matches this')
  await expect(page.getByText('No matches')).toBeVisible()

  await search.fill('')
  await expect(page.getByText('Toggle Page')).toBeVisible()
})
