// Spell-check "Add to Dictionary" persistence (V5 migration +
// add_dictionary_word/list_dictionary_words, both shells). Same
// real-Electron-app rationale as ink-layer-persistence.spec.ts — this
// needs a real SQLite file and a real app restart, not the browser-only
// e2e/ suite. Verifies a made-up misspelled word survives a full app
// restart against the same on-disk database.
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

const MADE_UP_WORD = 'flownotexyz'

async function decoratedWords(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.spellcheck-error'), (el) => el.textContent))
}

/** Finds the on-screen rect of `word` inside the page's one segment — needed to right-click exactly on it, not just anywhere in the segment box. */
async function rectOfWord(page: Page, word: string): Promise<{ x: number; y: number }> {
  const rect = await page.evaluate((w) => {
    const root = document.querySelector('[role="textbox"][aria-label="Segment"]')
    if (!root) return null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const idx = node.textContent?.indexOf(w) ?? -1
      if (idx !== -1) {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + w.length)
        const r = range.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }
    }
    return null
  }, word)
  if (!rect) throw new Error(`"${word}" not found in the segment`)
  return rect
}

test('a word added via "Add to Dictionary" survives a full app restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page

  await createFolderAndPage(page, 'Notes', 'Page')
  await page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  await page.keyboard.type(MADE_UP_WORD)
  // The decoration recompute is debounced (~300ms) after typing stops.
  await expect.poll(() => decoratedWords(page)).toEqual([MADE_UP_WORD])

  const wordPos = await rectOfWord(page, MADE_UP_WORD)
  await page.mouse.click(wordPos.x, wordPos.y, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Spelling suggestions' })
  await menu.waitFor()
  await menu.getByRole('menuitem', { name: 'Add to Dictionary' }).click()
  await expect.poll(() => decoratedWords(page)).toEqual([])

  // Restart against the *same* on-disk database — app.close() directly
  // (not closeApp, which would delete the directory) so launchApp's
  // `userDataDir` option can reopen it.
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page

  await createFolderAndPage(page, 'Other', 'Second page')
  await page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  await page.keyboard.type(MADE_UP_WORD)
  // Give the debounce window a chance to fire — asserting a *steady*
  // "no decoration" (not just "none yet") is the point of this test.
  await page.waitForTimeout(600)
  expect(await decoratedWords(page)).toEqual([])

  await closeApp(ctx)
})
