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

// Issue #10: getting out of a code block to type normal text below it.
test.describe('leaving a code block (issue #10)', () => {
  test.beforeEach(async ({ page }) => {
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await editable.pressSequentially('/')
    await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Code block' }).click()
    await page.keyboard.type('let a = 1\nlet b = 2')
  })

  test('Esc moves the caret to a normal line below the block', async ({ page }) => {
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await page.keyboard.press('Escape')
    await page.keyboard.type('After the code')
    await expect(editable.locator('pre code')).toHaveText('let a = 1\nlet b = 2')
    await expect(editable.locator(':scope > p').last()).toHaveText('After the code')
    // Esc again on the normal line does nothing odd; no extra lines appear.
    await expect(editable.locator(':scope > p')).toHaveCount(1)
  })

  test('clicking below the block puts the caret on a normal line under it', async ({ page }) => {
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    const segment = page.getByRole('textbox', { name: 'Segment' })
    const box = (await segment.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4)
    await page.keyboard.type('Below')
    await expect(editable.locator('pre code')).toHaveText('let a = 1\nlet b = 2')
    await expect(editable.locator(':scope > p').last()).toHaveText('Below')
  })

  test('clicking back into the block edits code again, and the language picker still works', async ({ page }) => {
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await page.keyboard.press('Escape')
    await page.keyboard.type('Text')
    await editable.locator('pre code').click()
    await page.keyboard.press('End')
    await page.keyboard.type(';')
    await expect(editable.locator('pre code')).toContainText(';')
    await page.getByRole('combobox', { name: 'Code language' }).selectOption('rust')
    await expect(editable.locator('pre code')).toHaveClass(/language-rust/)
    await expect(editable.locator(':scope > p').last()).toHaveText('Text')
  })

  test('Esc closes the "/" menu inside a segment with a code block, without leaving anything behind', async ({ page }) => {
    const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
    await page.keyboard.press('Escape')
    await page.keyboard.type('/')
    await expect(page.getByRole('menu', { name: 'Insert block' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Insert block' })).not.toBeVisible()
    await expect(editable.locator(':scope > p').last()).toHaveText('/')
  })
})
