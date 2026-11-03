// Generic AI interface (EXECUTION_PLAN.md Features) end to end in the real
// Electron app: providers configured through AI settings, requests made by
// the Rust sidecar, text streamed into the note. A local mock server speaks
// each provider's real streaming format (Claude Messages API, Gemini
// streamGenerateContent, OpenAI chat completions) and records requests.
import { expect, test } from '@playwright/test'
import type { Page } from 'playwright-core'
import { addProvider, startAiMockServer, type AiMockServer } from './aiMockServer'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

let mock: AiMockServer
let base = ''
test.beforeAll(async () => {
  mock = await startAiMockServer()
  base = mock.base
})
test.afterAll(() => mock.close())

async function ask(page: Page, provider: string, prompt: string) {
  await page.getByRole('combobox', { name: 'AI provider' }).selectOption({ label: provider })
  await page.getByRole('textbox', { name: 'AI prompt' }).fill(prompt)
  await page.getByRole('button', { name: 'Generate with AI' }).click()
}

test('Claude, Gemini and an OpenAI-compatible server stream into the note; keys stay in the backend; Stop and errors work', async () => {
  const ctx: LaunchedApp = await launchApp()
  const { page } = ctx
  const segment = page.locator('[data-testid^="segment-"] .ProseMirror').first()

  await createFolderAndPage(page, 'Notes', 'AI')
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('Meeting notes. ')

  // Configure three providers through AI settings.
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'AI settings' }).click()
  await addProvider(page, 'Claude (Anthropic)', base, 'sk-claude-secret')
  await addProvider(page, 'Gemini (Google)', base, 'gemini-secret')
  await addProvider(page, 'Ollama (local)', `${base}/v1`)
  const list = page.getByRole('list', { name: 'AI providers' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: 'Close AI settings' }).click()

  // Each provider streams into the active segment.
  await ask(page, 'Claude', 'Summarise')
  await expect(segment).toContainText('From Claude.')
  await ask(page, 'Gemini', 'Summarise')
  await expect(segment).toContainText('From Gemini.')
  await ask(page, 'Ollama', 'Summarise')
  await expect(segment).toContainText('From Ollama.')

  // The right request, with the right key, reached each service — and the
  // segment's text went along as context.
  const claudeReq = mock.seen.find((r) => r.path === '/v1/messages')!
  expect(claudeReq.headers['x-api-key']).toBe('sk-claude-secret')
  expect(claudeReq.headers['anthropic-version']).toBe('2023-06-01')
  expect(claudeReq.body.messages![0]!.content).toContain('Meeting notes.')
  expect(mock.seen.find((r) => r.path.startsWith('/v1beta/models/'))!.headers['x-goog-api-key']).toBe('gemini-secret')
  expect(mock.seen.find((r) => r.path === '/v1/chat/completions')!.headers.authorization).toBeUndefined()

  // Keys never reach the page.
  const pageText = await page.evaluate(() => document.documentElement.outerHTML)
  expect(pageText).not.toContain('sk-claude-secret')
  expect(pageText).not.toContain('gemini-secret')

  // Stop ends a long stream early and the backend drops the connection.
  await ask(page, 'Ollama', 'slow story')
  await expect(segment).toContainText('w1 ')
  await page.getByRole('button', { name: 'Stop AI' }).click()
  await expect(page.getByRole('status')).toHaveText('Stopped.')
  await expect.poll(() => mock.closedEarly()).toBeGreaterThan(0)
  expect(await segment.innerText()).not.toContain('w59')

  // AI can fill a brand-new, empty segment: focusing the AI prompt mustn't
  // auto-delete it (the ribbon keeps it alive, see SegmentHost's onBlur).
  await page.getByTestId('canvas-root').click({ position: { x: 600, y: 420 } })
  const fresh = page.locator('[data-testid^="segment-"] .ProseMirror').last()
  await expect(fresh).toHaveText('')
  await ask(page, 'Claude', 'Write an intro')
  await expect(fresh).toHaveText('From Claude.')

  // An unreachable provider shows a readable error.
  await page.getByRole('button', { name: 'AI settings' }).click()
  await addProvider(page, 'Other OpenAI-compatible service', 'http://127.0.0.1:9/v1', undefined, 'Offline server')
  await expect(list.getByRole('listitem')).toHaveCount(4)
  await page.getByRole('button', { name: 'Close AI settings' }).click()
  await ask(page, 'Offline server', 'hi')
  await expect(page.getByRole('status')).toContainText("Couldn't reach the AI provider")

  await closeApp(ctx)
})
