// EXECUTION_PLAN.md Phase 6 E2E: "segment create" + the empty-canvas hint /
// invisible-by-default segment model (DESIGN.md §4.1).
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'E2E Folder', 'E2E Page')
})

test('clicking empty canvas creates a segment and it is immediately typeable', async ({ page }) => {
  await expect(page.getByText('Click anywhere to start writing')).toBeVisible()

  await clickCanvasAt(page, 100, 100)
  await expect(page.getByText('Click anywhere to start writing')).not.toBeVisible()

  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await expect(editable).toBeVisible()
  await expect(editable).toBeFocused()

  await page.keyboard.type('Hello from e2e')
  await expect(editable).toHaveText('Hello from e2e')
})

test('an empty segment disappears on blur; a non-empty one does not', async ({ page }) => {
  await clickCanvasAt(page, 100, 100)
  const segment = page.getByRole('textbox', { name: 'Segment' }).first()
  await expect(segment).toBeVisible()

  // Blur without typing anything — empty + uncoloured segments auto-delete
  // (DESIGN.md §4.1).
  await page.keyboard.press('Escape')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await expect(segment).not.toBeVisible()
  await expect(page.getByText('Click anywhere to start writing')).toBeVisible()

  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('keeper')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('textbox', { name: 'Segment' }).first()).toBeVisible()
})

test('clicking two different spots creates two independent, non-overlapping segments', async ({ page }) => {
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('first')
  await clickCanvasAt(page, 500, 400)
  await page.keyboard.type('second')

  const boxes = await page.getByRole('textbox', { name: 'Segment' }).evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()),
  )
  expect(boxes).toHaveLength(2)
  const [a, b] = boxes as [DOMRect, DOMRect]
  const overlaps = a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top
  expect(overlaps).toBe(false)
})
