// DESIGN.md §9.3: `network:fetch` — "External HTTP requests from the plugin
// iframe; blocked by CSP without it". Checked against a real local server
// from inside both kinds of plugin document: the registration iframe (an
// about:srcdoc page the app builds, policy in a <meta>) and a block iframe
// (the plugin's own grid.html over flownote-plugin://, policy as a header).
import { expect, test } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Frame, Page } from 'playwright-core'
import {
  clickCanvasAt,
  closeApp,
  createFolderAndPage,
  launchApp,
  SPREADSHEET_MANIFEST,
  waitForGridFrame,
  type LaunchedApp,
} from './helpers'

let server: http.Server
let hits = 0
let url = ''

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' })
    res.end('pong')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** Tries every kind of network access from inside `frame`; returns what happened to each. */
function tryNetwork(frame: Frame, target: string) {
  return frame.evaluate(async (u) => {
    const settle = <T,>(p: Promise<T>, ms = 2000) =>
      Promise.race([p, new Promise<string>((r) => setTimeout(() => r('timeout'), ms))])
    const results: Record<string, string> = {}
    results.fetch = await settle(fetch(u).then((r) => r.text(), () => 'blocked'))
    results.xhr = await settle(
      new Promise<string>((resolve) => {
        const x = new XMLHttpRequest()
        x.onload = () => resolve(x.responseText)
        x.onerror = () => resolve('blocked')
        try {
          x.open('GET', u)
          x.send()
        } catch {
          resolve('blocked')
        }
      }),
    )
    results.image = await settle(
      new Promise<string>((resolve) => {
        const img = new Image()
        img.onload = () => resolve('loaded')
        img.onerror = () => resolve('blocked')
        img.src = u + 'pixel.png'
      }),
    )
    results.websocket = await settle(
      new Promise<string>((resolve) => {
        try {
          const ws = new WebSocket(u.replace('http', 'ws'))
          ws.onopen = () => resolve('open')
          ws.onerror = () => resolve('blocked')
        } catch {
          resolve('blocked')
        }
      }),
    )
    results.eventsource = await settle(
      new Promise<string>((resolve) => {
        try {
          const es = new EventSource(u + 'events')
          es.onopen = () => resolve('open')
          es.onerror = () => {
            es.close()
            resolve('blocked')
          }
        } catch {
          resolve('blocked')
        }
      }),
    )
    return results
  }, target)
}

const BLOCKED = { fetch: 'blocked', xhr: 'blocked', image: 'blocked', websocket: 'blocked', eventsource: 'blocked' }

/** The plugin's hidden registration iframe (PluginManager's `srcdoc` page) — found by its element: Playwright reports a sandboxed srcdoc frame's URL as about:blank. */
async function registrationFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('iframe[sandbox="allow-scripts"][style*="display: none"]').elementHandle()
  const frame = await handle!.contentFrame()
  await expect.poll(() => frame!.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]') !== null)).toBe(true)
  return frame!
}

async function installSpreadsheet(page: Page, manifestJson: string) {
  await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
  await page.getByRole('button', { name: 'Install…' }).click()
  await page.getByRole('textbox', { name: 'Plugin manifest JSON' }).fill(manifestJson)
  await page.getByRole('button', { name: 'Install', exact: true }).click()
  await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
}

test('a plugin without network:fetch can\'t reach the network; with it, it can', async () => {
  const ctx: LaunchedApp = await launchApp()
  const { page } = ctx

  // 1. The spreadsheet as shipped: storage permissions only.
  await installSpreadsheet(page, SPREADSHEET_MANIFEST)
  await createFolderAndPage(page, 'Notes', 'Sheet')
  await clickCanvasAt(page, 100, 100)
  await page.keyboard.type('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Spreadsheet' }).click()
  const grid = await waitForGridFrame(page)
  await expect.poll(() => grid.evaluate(() => document.querySelectorAll('table input').length)).toBeGreaterThan(0)

  expect(await tryNetwork(await registrationFrame(page), url)).toEqual(BLOCKED)
  expect(await tryNetwork(grid, url)).toEqual(BLOCKED)
  expect(hits).toBe(0) // blocked before anything left the app

  // The plugin's own files are still fine.
  expect(await grid.evaluate(() => fetch('flownote-plugin://localhost/sdk/index.js').then((r) => r.status))).toBe(200)

  // 2. Same plugin, reinstalled declaring network:fetch, then reloaded.
  const withNetwork = JSON.parse(SPREADSHEET_MANIFEST) as { permissions: string[] }
  withNetwork.permissions.push('network:fetch')
  await installSpreadsheet(page, JSON.stringify(withNetwork))
  await page.reload()
  await page.waitForSelector('[aria-label="New page"]')
  await page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('list', { name: 'Files' }).getByRole('button', { name: 'Sheet' }).click()
  const grid2 = await waitForGridFrame(page)
  await expect.poll(() => grid2.evaluate(() => document.querySelectorAll('table input').length)).toBeGreaterThan(0)

  expect(await (await registrationFrame(page)).evaluate((u) => fetch(u).then((r) => r.text()), url)).toBe('pong')
  expect(await grid2.evaluate((u) => fetch(u).then((r) => r.text()), url)).toBe('pong')
  expect(hits).toBeGreaterThanOrEqual(2)

  await closeApp(ctx)
})
