// Right-click → "Delete segment" with an undo toast (issue #29).
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Delete Folder', 'Delete Page')
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('segment to delete')
})

const segments = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Segment' })

async function deleteFirstSegment(page: import('@playwright/test').Page) {
  await segments(page).first().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Segment colour' }).getByRole('menuitem', { name: 'Delete segment' }).click()
}

test('deletes a coloured segment with text, and Undo restores it', async ({ page }) => {
  // Colour it first: a coloured segment is never auto-deleted.
  await segments(page).first().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Segment colour' }).getByRole('menuitemradio', { name: 'Colour #2563eb' }).click()

  await deleteFirstSegment(page)
  await expect(segments(page)).toHaveCount(0)
  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toContainText('Segment deleted')

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(toast).toBeHidden()
  await expect(segments(page)).toHaveCount(1)
  await expect(segments(page).first()).toContainText('segment to delete')
  await expect(segments(page).first()).toHaveCSS('border-top-color', 'rgb(37, 99, 235)')
})

test('Ctrl+Z undoes the deletion; the toast goes away on its own', async ({ page }) => {
  await deleteFirstSegment(page)
  await expect(segments(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(segments(page)).toHaveCount(1)

  await deleteFirstSegment(page)
  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toBeVisible()
  await expect(toast).toBeHidden({ timeout: 12_000 })
  await expect(segments(page)).toHaveCount(0)
})
