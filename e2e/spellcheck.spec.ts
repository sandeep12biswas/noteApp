// Spell-check UI-only behavior — the browser-only suite (no real
// IPCAdapter/backend, see this directory's own playwright.config.ts), so
// this only covers what doesn't need persistence: the live decoration and
// picking a suggestion. "Add to Dictionary" surviving a restart needs the
// real Electron app + real SQLite, covered separately by
// e2e-electron/dictionary-persistence.spec.ts.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Spelling Folder', 'Spelling Page')
  await clickCanvasAt(page, 100, 100)
})

test('a misspelled word gets a wavy underline, and picking a suggestion corrects it', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('recieve')

  await expect(page.locator('.spellcheck-error')).toHaveText('recieve')

  const wordBox = await page.locator('.spellcheck-error').boundingBox()
  if (!wordBox) throw new Error('misspelled word has no bounding box')
  await page.mouse.click(wordBox.x + wordBox.width / 2, wordBox.y + wordBox.height / 2, { button: 'right' })

  const menu = page.getByRole('menu', { name: 'Spelling suggestions' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'receive' }).click()

  await expect(editable).toHaveText('receive')
  await expect(page.locator('.spellcheck-error')).toHaveCount(0)
})
