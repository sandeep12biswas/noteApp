// "/ Ask AI" in the real desktop app: the request goes through the Rust
// sidecar to a mock provider (aiMockServer.ts), the answer streams in as a
// draft, and Keep / Discard / Stop / Try again behave as designed.
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { addProvider, startAiMockServer, type AiMockServer } from './aiMockServer'
import { closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

let mock: AiMockServer
test.beforeAll(async () => {
  mock = await startAiMockServer()
})
test.afterAll(() => mock.close())

const chatRequests = () => mock.seen.filter((r) => r.path === '/v1/chat/completions')

async function askAI(page: Page, prompt: string) {
  await page.keyboard.type('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Ask AI…' }).click()
  await page.getByRole('textbox', { name: 'AI prompt for this segment' }).fill(prompt)
  await page.keyboard.press('Enter')
}

test('"/ Ask AI" drafts in the destination formatting; Keep, Discard, Stop and Try again work; kept text survives a restart', async () => {
  let ctx: LaunchedApp = await launchApp()
  let page = ctx.page
  await createFolderAndPage(page, 'Notes', 'AI page')

  // One OpenAI-compatible provider (Ollama preset) pointing at the mock.
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'AI settings' }).click()
  await addProvider(page, 'Ollama (local)', `${mock.base}/v1`)
  await page.getByRole('button', { name: 'Close AI settings' }).click()
  await page.getByRole('tab', { name: 'Home' }).click()

  await page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  const editable = page.locator('[data-testid^="segment-"] .ProseMirror')
  await expect(editable).toBeFocused()
  const bar = page.getByRole('toolbar', { name: 'AI draft' })

  // Destination formatting: bold, 24px on the line where "/" is typed.
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.getByRole('combobox', { name: 'Font size' }).selectOption('24')
  await askAI(page, 'lines please')

  // The prompt line, then the answer — newline made a new paragraph — tinted as a draft.
  await expect(editable.locator('p')).toHaveText(['lines please', 'Line one', 'Line two'])
  await expect(editable.locator('.ai-draft').first()).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Keep' })).toBeVisible()
  // Only the prompt went to the AI — no note text as context.
  expect(chatRequests().at(-1)!.body.messages!.at(-1)!.content).toBe('lines please')

  await bar.getByRole('button', { name: 'Keep' }).click()
  await expect(bar).toHaveCount(0)
  await expect(editable.locator('.ai-draft')).toHaveCount(0)
  for (const text of ['lines please', 'Line one', 'Line two']) {
    const strong = editable.locator('strong', { hasText: text })
    await expect(strong).toBeVisible()
    await expect(strong).toHaveCSS('font-size', '24px')
  }

  // One undo removes everything that was kept; redo brings it back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editable).not.toContainText('Line')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editable.locator('p')).toHaveText(['lines please', 'Line one', 'Line two'])

  // Escape discards: the prompt and the answer both go.
  await page.keyboard.press('Enter')
  await askAI(page, 'hello')
  await expect(editable).toContainText('From Ollama.')
  await expect(bar.getByRole('button', { name: 'Keep' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
  await expect(editable).not.toContainText('From Ollama.')
  await expect(editable).not.toContainText('hello')

  // Stop part-way: the backend drops the connection; Try again asks again.
  const closedBefore = mock.closedEarly()
  await askAI(page, 'slow story')
  await expect(editable).toContainText('w1 ')
  await bar.getByRole('button', { name: 'Stop' }).click()
  await expect(bar.getByRole('status')).toHaveText('Stopped.')
  await expect.poll(() => mock.closedEarly()).toBeGreaterThan(closedBefore)
  expect(await editable.innerText()).not.toContain('w59')
  const requestsBefore = chatRequests().length
  await bar.getByRole('button', { name: 'Try again' }).click()
  await expect.poll(() => chatRequests().length).toBe(requestsBefore + 1)
  await expect(editable).toContainText('w0 ')
  await bar.getByRole('button', { name: 'Stop' }).click()
  await bar.getByRole('button', { name: 'Discard' }).click()
  await expect(editable).not.toContainText('slow story')

  // The kept text is saved like any other text.
  await page.waitForTimeout(1500) // debounced save
  await ctx.app.close()
  ctx = await launchApp({ userDataDir: ctx.userDataDir })
  page = ctx.page
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'AI page' }).click()
  const reopened = page.locator('[data-testid^="segment-"] .ProseMirror')
  await expect(reopened.locator('strong', { hasText: 'Line two' })).toBeVisible()
  await expect(reopened.locator('.ai-draft')).toHaveCount(0)

  await closeApp(ctx)
})
