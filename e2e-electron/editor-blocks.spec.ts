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

// Issue #9 in the desktop app: Format Painter onto a word picked by
// double-click (it used to paint only drag selections).
test('Format Painter paints a double-clicked word', async () => {
  const ctx: LaunchedApp = await launchApp()
  const page = ctx.page
  await createFolderAndPage(page, 'Notes', 'Painter')
  await page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await expect(editable).toBeFocused()
  await page.keyboard.type('Styled plain')

  const centre = async (word: string) =>
    editable.evaluate((el, word) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const i = t.textContent!.indexOf(word)
        if (i < 0) continue
        const range = document.createRange()
        range.setStart(t, i)
        range.setEnd(t, i + word.length)
        const b = range.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      throw new Error(`"${word}" not found`)
    }, word)

  let p = await centre('Styled')
  await page.mouse.dblclick(p.x, p.y)
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.mouse.dblclick(p.x, p.y)
  const painter = page.getByRole('button', { name: 'Format Painter' })
  await painter.click()
  await expect(painter).toHaveAttribute('aria-pressed', 'true')

  p = await centre('plain')
  await page.mouse.dblclick(p.x, p.y)
  await expect(editable.locator('strong', { hasText: 'plain' })).toBeVisible()
  await expect(painter).toHaveAttribute('aria-pressed', 'false')

  await closeApp(ctx)
})
