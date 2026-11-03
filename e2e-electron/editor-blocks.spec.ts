// Issues #7 and #8 in the real desktop app: the "/" menu driven from the
// keyboard, and a highlighted code block whose language survives a save
// and a full restart through the Rust sidecar's SQLite store.
import { expect, test } from '@playwright/test'
import { closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

test('"/" menu works from the keyboard, and a code block keeps its language across a restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page

  await createFolderAndPage(page, 'Notes', 'Snippets')
  await page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  const menu = page.getByRole('menu', { name: 'Insert block' })

  // #8: arrows + Enter straight from the editor.
  await page.keyboard.type('/')
  await expect(menu).toBeVisible()
  await page.keyboard.press('ArrowDown') // Heading 1
  await page.keyboard.press('Enter')
  await page.keyboard.type('Snippets')
  await expect(editable.locator('h1')).toHaveText('Snippets')

  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.keyboard.press('ArrowUp') // wraps to Code block
  await expect(menu.locator('[data-active]')).toHaveText('Code block')
  await page.keyboard.press('Enter')
  await page.keyboard.type('def add(a, b):\n    return a + b')

  // #7: pick a language; the code is highlighted for it.
  await page.getByRole('combobox', { name: 'Code language' }).selectOption('python')
  await expect(editable.locator('pre .hljs-keyword').first()).toHaveText('def')
  await page.screenshot({ path: test.info().outputPath('code-block.png') })

  await page.waitForTimeout(1500) // let the debounced save reach the sidecar
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page

  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Snippets' }).click()
  const reopened = page.locator('[data-testid^="segment-"] .ProseMirror')
  await expect(reopened.locator('h1')).toHaveText('Snippets')
  await expect(page.getByRole('combobox', { name: 'Code language' })).toHaveValue('python')
  await expect(reopened.locator('pre .hljs-keyword').first()).toHaveText('def')

  await closeApp(ctx)
})
