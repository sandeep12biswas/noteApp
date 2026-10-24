// Generic AI interface (EXECUTION_PLAN.md Features) end to end in the real
// Electron app: providers configured through AI settings, requests made by
// the Rust sidecar, text streamed into the note. A local mock server speaks
// each provider's real streaming format (Claude Messages API, Gemini
// streamGenerateContent, OpenAI chat completions) and records requests.
import { expect, test } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'
import { clickCanvasAt, closeApp, createFolderAndPage, launchApp, type LaunchedApp } from './helpers'

interface Seen {
  path: string
  headers: http.IncomingHttpHeaders
  body: { messages?: { content: string }[]; contents?: { parts: { text: string }[] }[] }
}
const seen: Seen[] = []
let closedEarly = 0
let server: http.Server
let base = ''

const sse = (res: http.ServerResponse, events: string[], delayMs = 5) =>
  new Promise<void>((resolve) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    let i = 0
    const tick = () => {
      if (res.destroyed) return resolve()
      if (i === events.length) return res.end(resolve)
      res.write(events[i++] + '\n\n')
      setTimeout(tick, delayMs)
    }
    tick()
  })

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      seen.push({ path: req.url!, headers: req.headers, body })
      res.on('close', () => {
        if (!res.writableFinished) closedEarly++
      })
      if (req.url === '/v1/messages') {
        void sse(res, [
          'event: message_start\ndata: {"type":"message_start","message":{}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"From "}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude."}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
        ])
      } else if (req.url!.startsWith('/v1beta/models/')) {
        void sse(res, [
          'data: {"candidates":[{"content":{"parts":[{"text":"From "}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":"Gemini."}]},"finishReason":"STOP"}]}',
        ])
      } else if (req.url === '/v1/chat/completions') {
        const slow = body.messages?.[1]?.content.startsWith('slow')
        const words = slow ? Array.from({ length: 60 }, (_, i) => `w${i} `) : ['From ', 'Ollama.']
        void sse(res, [...words.map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}`), 'data: [DONE]'], slow ? 100 : 5)
      } else {
        res.writeHead(404).end()
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

async function addProvider(page: Page, service: string, baseUrl: string, apiKey?: string, name?: string) {
  await page.getByRole('button', { name: 'Add provider' }).click()
  await page.getByRole('combobox', { name: 'Service' }).selectOption({ label: service })
  if (name) await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('textbox', { name: 'Base URL' }).fill(baseUrl)
  if (apiKey) await page.getByLabel('API key').fill(apiKey)
  await page.getByRole('button', { name: 'Save' }).click()
}

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
  const claudeReq = seen.find((r) => r.path === '/v1/messages')!
  expect(claudeReq.headers['x-api-key']).toBe('sk-claude-secret')
  expect(claudeReq.headers['anthropic-version']).toBe('2023-06-01')
  expect(claudeReq.body.messages![0]!.content).toContain('Meeting notes.')
  expect(seen.find((r) => r.path.startsWith('/v1beta/models/'))!.headers['x-goog-api-key']).toBe('gemini-secret')
  expect(seen.find((r) => r.path === '/v1/chat/completions')!.headers.authorization).toBeUndefined()

  // Keys never reach the page.
  const pageText = await page.evaluate(() => document.documentElement.outerHTML)
  expect(pageText).not.toContain('sk-claude-secret')
  expect(pageText).not.toContain('gemini-secret')

  // Stop ends a long stream early and the backend drops the connection.
  await ask(page, 'Ollama', 'slow story')
  await expect(segment).toContainText('w1 ')
  await page.getByRole('button', { name: 'Stop AI' }).click()
  await expect(page.getByRole('status')).toHaveText('Stopped.')
  await expect.poll(() => closedEarly).toBeGreaterThan(0)
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
