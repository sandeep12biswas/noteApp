// EXECUTION_PLAN.md Phase 6 E2E: "drag" — DESIGN.md §4.6 collision system.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Drag Folder', 'Drag Page')
})

test('dragging a segment toward another stops at the 8px minimum gap', async ({ page }) => {
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('a')
  await clickCanvasAt(page, 500, 400)
  await page.keyboard.type('b')

  const segments = page.getByRole('textbox', { name: 'Segment' })
  await expect(segments).toHaveCount(2)
  const [firstBox, secondBox] = await segments.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
  if (!firstBox || !secondBox) throw new Error('expected two segment boxes')

  // Segment B (just typed into, so already active) is the drag target —
  // its handles only render while `revealed` (active or coloured, DESIGN.md
  // §4.1), so this has to happen right after typing into it, not after
  // blurring both segments.
  const handle = segments.nth(1).getByTestId(/-drag-handle$/)
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('drag handle has no bounding box')

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  // Aligned with segment A's own x-range and just below it, within the
  // gap-highlight threshold — a clean vertical gap (not diagonal), the
  // case DESIGN.md Phase 3's dashed gap-line follow-up should draw one for.
  await page.mouse.move(firstBox.left + firstBox.width / 2, firstBox.top + firstBox.height + 10, { steps: 10 })
  await expect(page.locator('[data-testid="gap-line"]')).toHaveCount(1)

  await page.mouse.move(handleBox.x + handleBox.width / 2, firstBox.top + firstBox.height / 2, { steps: 5 })
  await page.mouse.up()
  // The gap-line overlay is drag/resize-only scaffolding — dropped once the move commits.
  await expect(page.locator('[data-testid="gap-line"]')).toHaveCount(0)

  const finalBoxes = await segments.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
  const [a, b] = finalBoxes as [DOMRect, DOMRect]
  const horizontalOverlap = a.left < b.left + b.width && a.left + a.width > b.left
  const verticalGap = Math.max(b.top - (a.top + a.height), a.top - (b.top + b.height))
  if (horizontalOverlap) expect(verticalGap).toBeGreaterThanOrEqual(7)
})
