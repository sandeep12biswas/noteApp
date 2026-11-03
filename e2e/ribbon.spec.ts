// Issue #4 (ribbon half): clicking a ribbon button used to blur the segment
// editor, and `chain().focus()` restores focus only a frame later, so text
// typed straight after the click was lost. RibbonButton now cancels the
// mousedown. Timing bug — run with `--repeat-each` when touching this.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Ribbon Folder', 'Ribbon Page')
  await clickCanvasAt(page, 100, 100)
})

test('text typed immediately after clicking Bold is kept, and is bold', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await page.keyboard.type('plain ')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.type('Action items')
  await expect(editable).toHaveText('plain Action items')
  await expect(editable.locator('strong')).toHaveText('Action items')
})
