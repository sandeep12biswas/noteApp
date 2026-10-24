// Issue #1: the H1/H2/H3 ribbon buttons toggled the right node, but it
// rendered exactly like a paragraph — Tailwind's preflight resets h1–h3 to
// `font-size/font-weight: inherit`, and nothing set them back (fixed in
// a6a4195 by `.ProseMirror h1/h2/h3` in index.css). Measured on the typed
// *text*, not the heading element, so an inline font size from the
// segment's default font (applyDefaultFontIfNew) overriding the heading
// would also be caught.
import { expect, test, type Page } from '@playwright/test'
import { clickCanvasAt, createFolderAndPage } from './helpers'

async function textStyle(page: Page, text: string): Promise<{ tag: string; size: number; weight: number }> {
  return page.evaluate((t) => {
    // Find the block by its whole text, then measure its first text node's
    // element: a spell-check underline can split the text into several
    // nodes (it briefly marks a half-typed word until its debounced recheck).
    const block = [...document.querySelectorAll('.ProseMirror :is(p, h1, h2, h3)')].find((b) => b.textContent === t)
    if (!block) throw new Error(`no block with text "${t}" in ${document.querySelector('.ProseMirror')!.innerHTML}`)
    const firstText = document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode()!
    const style = getComputedStyle(firstText.parentElement!)
    return { tag: block.tagName, size: parseFloat(style.fontSize), weight: Number(style.fontWeight) }
  }, text)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await createFolderAndPage(page, 'Heading Folder', 'Heading Page')
  await clickCanvasAt(page, 100, 100)
})

test('ribbon H1/H2/H3 render larger and bolder than body text, in descending size', async ({ page }) => {
  await page.keyboard.type('body text')
  const body = await textStyle(page, 'body text')

  const sizes: number[] = []
  for (const level of ['1', '2', '3']) {
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: `Heading ${level}`, exact: true }).click()
    await page.keyboard.type(`heading ${level}`)
    const h = await textStyle(page, `heading ${level}`)
    expect(h.tag).toBe(`H${level}`)
    expect(h.size).toBeGreaterThan(body.size)
    expect(h.weight).toBeGreaterThanOrEqual(600)
    expect(h.weight).toBeGreaterThan(body.weight)
    sizes.push(h.size)
  }
  expect(sizes[0]).toBeGreaterThan(sizes[1]!)
  expect(sizes[1]).toBeGreaterThan(sizes[2]!)
})

test('a slash-menu Heading 1 renders larger and bolder than body text', async ({ page }) => {
  await page.keyboard.type('body text')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Heading 1' }).click()
  await page.keyboard.type('slash heading')

  const body = await textStyle(page, 'body text')
  const h = await textStyle(page, 'slash heading')
  expect(h.tag).toBe('H1')
  expect(h.size).toBeGreaterThan(body.size)
  expect(h.weight).toBeGreaterThan(body.weight)
})
