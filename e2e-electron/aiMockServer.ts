// A local stand-in for the AI providers, shared by the Electron AI specs
// (ai.spec.ts, ai-slash.spec.ts). It speaks each provider's real streaming
// format — Claude Messages API, Gemini streamGenerateContent, OpenAI chat
// completions — and records every request.
//
// OpenAI-compatible replies depend on the prompt:
// - starts with "slow": 60 words, 100ms apart (for Stop);
// - starts with "lines": "Line one\nLine two" (newlines become paragraphs);
// - anything else: "From Ollama.".
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'

export interface SeenRequest {
  path: string
  headers: http.IncomingHttpHeaders
  body: { messages?: { role?: string; content: string }[]; contents?: { parts: { text: string }[] }[] }
}

export interface AiMockServer {
  /** e.g. http://127.0.0.1:41234 — Claude/Gemini base URL; add `/v1` for OpenAI-compatible. */
  base: string
  seen: SeenRequest[]
  /** Responses the client hung up on before they finished (Stop / cancel). */
  closedEarly: () => number
  close: () => Promise<void>
}

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

export async function startAiMockServer(): Promise<AiMockServer> {
  const seen: SeenRequest[] = []
  let closedEarly = 0
  const server = http.createServer((req, res) => {
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
        const prompt: string = body.messages?.[1]?.content ?? ''
        const slow = prompt.startsWith('slow')
        const words = slow
          ? Array.from({ length: 60 }, (_, i) => `w${i} `)
          : prompt.startsWith('lines')
            ? ['Line one', '\nLine ', 'two']
            : ['From ', 'Ollama.']
        void sse(res, [...words.map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}`), 'data: [DONE]'], slow ? 100 : 5)
      } else {
        res.writeHead(404).end()
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    closedEarly: () => closedEarly,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

/** Adds a provider through the open AI settings dialog. */
export async function addProvider(page: Page, service: string, baseUrl: string, apiKey?: string, name?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add provider' }).click()
  await page.getByRole('combobox', { name: 'Service' }).selectOption({ label: service })
  if (name) await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('textbox', { name: 'Base URL' }).fill(baseUrl)
  if (apiKey) await page.getByLabel('API key').fill(apiKey)
  await page.getByRole('dialog', { name: 'AI settings' }).getByRole('button', { name: 'Save', exact: true }).click()
}
