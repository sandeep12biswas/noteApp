// Issue #7: code blocks get a language picker and syntax highlighting.
import { expect, test } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Code Folder', 'Code Page')
  await clickCanvasAt(page, 100, 100)
})

test('a code block from the "/" menu has a language picker and highlights the chosen language', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Code block' }).click()
  await page.keyboard.type('def greet(name):\n    return "hi " + name')

  const picker = page.getByRole('combobox', { name: 'Code language' })
  await expect(picker).toBeVisible()
  await expect(picker).toHaveValue('') // Auto-detect

  await picker.selectOption('python')
  await expect(editable.locator('pre code')).toHaveClass(/language-python/)
  const keyword = editable.locator('pre .hljs-keyword').first()
  await expect(keyword).toHaveText('def')
  const plainColor = await editable.locator('pre').evaluate((el) => getComputedStyle(el).color)
  expect(await keyword.evaluate((el) => getComputedStyle(el).color)).not.toBe(plainColor)
  await expect(editable.locator('pre .hljs-string').first()).toHaveText('"hi "')
})

test('switching language re-highlights the same code', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Code block' }).click()
  await page.keyboard.type('fn main() { let x = 1; }')
  const picker = page.getByRole('combobox', { name: 'Code language' })
  await picker.selectOption('rust')
  await expect(editable.locator('pre .hljs-keyword').first()).toHaveText('fn')
  await picker.selectOption('plaintext')
  await expect(editable.locator('pre .hljs-keyword')).toHaveCount(0)
})

test('auto-detect highlights code with no language chosen', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Code block' }).click()
  await page.keyboard.type('SELECT id, name FROM users WHERE id = 1;')
  await expect(editable.locator('pre [class^="hljs-"]').first()).toBeVisible()
})

test('```js at the start of a line makes a JavaScript code block', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('```javascript ')
  await expect(page.getByRole('combobox', { name: 'Code language' })).toHaveValue('javascript')
  await page.keyboard.type('const answer = 42')
  await expect(editable.locator('pre .hljs-keyword').first()).toHaveText('const')
})

test('typing in the code block after using the picker still works', async ({ page }) => {
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await editable.pressSequentially('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Code block' }).click()
  await page.getByRole('combobox', { name: 'Code language' }).selectOption('typescript')
  await editable.locator('pre code').click()
  await page.keyboard.type('let n: number = 1')
  await expect(editable.locator('pre code')).toHaveText('let n: number = 1')
  await expect(page.getByRole('textbox', { name: 'Segment' })).toHaveCount(1) // still there, not auto-deleted
})
