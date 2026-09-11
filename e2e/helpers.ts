// Shared setup for e2e specs — EXECUTION_PLAN.md Phase 6 "E2E test suite".
// The app has no default folder/page selected on a fresh load (client-only
// state, no IPCAdapter in this browser-only suite — see playwright.config.ts),
// so every spec starts from the same "create a folder, create a page inside
// it" flow PageList.test.tsx's "new-page flow" tests already exercise at the
// unit level; this is the same flow driven through a real browser instead.
import type { Page } from '@playwright/test'

export async function createFolderAndPage(page: Page, folderName: string, pageName: string): Promise<void> {
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('radio', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill(folderName)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill(pageName)
  await page.getByRole('button', { name: 'Create' }).click()
}

/** Clicks the empty canvas at a point clear of any existing segments. */
export async function clickCanvasAt(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByTestId('canvas-root')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas-root has no bounding box')
  await page.mouse.click(box.x + x, box.y + y)
}
