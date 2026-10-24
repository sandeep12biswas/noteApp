// Smoke test for the *installed* Windows (Tauri/WebView2) app, run by
// .github/workflows/windows-installer.yml after installing setup.exe.
//
// FlowNote must already be running with WebView2's DevTools port open,
// via the app's own test hook (apps/tauri/src-tauri/src/lib.rs):
//   $env:FLOWNOTE_WEBVIEW_DEBUG_PORT = '9222'
// This attaches Playwright over CDP and checks the Windows-specific paths
// that can't be exercised on Linux: custom schemes served as
// http://<scheme>.localhost/…, plugin iframes loading through them, and
// attachment images — plus basic IPC/persistence through the real backend.
//
//   node e2e-tauri/windows-smoke.mjs [cdpUrl]
// Exit code 0 = all checks passed.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = createRequire(path.join(REPO, 'package.json'))('playwright-core')
const cdpUrl = process.argv[2] ?? 'http://127.0.0.1:9222'
const MANIFEST = fs.readFileSync(path.join(REPO, 'plugins/spreadsheet/flownote-plugin.json'), 'utf8')
// 4x3 red PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGP4z8AARww4OQD1MQv1NXv7ggAAAABJRU5ErkJggg=='

let failures = 0
async function check(name, fn) {
  try {
    const detail = await fn()
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}  ${e.message.split('\n')[0]}`)
  }
}
function expectEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function connect() {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      return await chromium.connectOverCDP(cdpUrl)
    } catch (e) {
      if (Date.now() > deadline) throw e
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

const browser = await connect()
const appPage = () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost'))
let page = appPage()
if (!page) throw new Error(`no tauri.localhost page; pages: ${browser.contexts().flatMap((c) => c.pages()).map((p) => p.url())}`)
await page.waitForSelector('[aria-label="New page"]', { timeout: 30_000 })
const invoke = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])

await check('custom-scheme prefix is the Windows form', async () => {
  const prefix = await page.evaluate(() => window.__TAURI_INTERNALS__.convertFileSrc('', 'flownote-plugin'))
  expectEqual(prefix, 'http://flownote-plugin.localhost/', 'convertFileSrc prefix')
})

await check('flownote-plugin serves the SDK, 404s missing files and the app shell', async () => {
  const r = await page.evaluate(async () => {
    const base = 'http://flownote-plugin.localhost/'
    const sdk = await fetch(base + 'sdk/index.js')
    return {
      sdk: sdk.status,
      type: sdk.headers.get('content-type'),
      missing: (await fetch(base + 'plugins/com.sandeep.spreadsheet/nope.js')).status,
      shell: (await fetch(base + 'index.html')).status,
    }
  })
  expectEqual(r.sdk, 200, 'sdk status')
  expectEqual(r.missing, 404, 'missing file status')
  expectEqual(r.shell, 404, 'app shell status')
  return r.type
})

await check('IPC round trip: save segment, then search finds it', async () => {
  await invoke('save_folder', { folder: { id: 'smoke-f', name: 'Smoke', parentId: null, icon: null, expanded: false } })
  await invoke('save_page', { page: { id: 'smoke-p', folderId: 'smoke-f', title: 'Smoke Page' } })
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'windows smoke text' }] }] }
  await invoke('save_segment', {
    segment: { id: 'smoke-s', pageId: 'smoke-p', x: 0, y: 0, w: 100, h: 50, zIndex: 0, borderColor: null, fillColor: null, content },
  })
  const hits = await invoke('search', { query: 'smoke', notebookId: 'nb-1' })
  expectEqual(hits.length, 1, 'search hits')
})

await check('flownote-attachment serves an image that renders', async () => {
  await invoke('save_attachment', { id: 'smoke-img', segmentId: 'smoke-s', fileName: 'red.png', mimeType: 'image/png', dataBase64: PNG_BASE64 })
  const size = await page.evaluate(
    (url) =>
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`)
        img.onerror = () => reject(new Error('image failed to load'))
        img.src = url
      }),
    'http://flownote-attachment.localhost/smoke-img',
  )
  expectEqual(size, '4x3', 'image size')
})

await check('spreadsheet plugin: loads after restart-equivalent reload, registers /sheet, grid renders', async () => {
  await invoke('install_plugin', { source: MANIFEST })
  await page.reload()
  page = appPage()
  await page.waitForSelector('[aria-label="New page"]', { timeout: 30_000 })
  // Loaded on startup, without opening the Plugins panel.
  await page.locator('iframe[sandbox="allow-scripts"]').first().waitFor({ state: 'attached', timeout: 15_000 })

  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('radio', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Sheets')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill('Grid')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 } })
  await page.keyboard.type('/')
  await page.getByRole('menu', { name: 'Insert block' }).getByRole('menuitem', { name: 'Spreadsheet' }).click()

  // The grid iframe's own page imports the SDK via its root-relative import
  // map; a rendered <table> means grid.js (and so the SDK import) ran.
  const deadline = Date.now() + 15_000
  for (;;) {
    const grid = page.frames().find((f) => f.url().includes('grid.html'))
    if (grid) {
      const cells = await grid.evaluate(() => document.querySelectorAll('table input').length).catch(() => 0)
      if (cells > 0) return `${grid.url()} — ${cells} cells`
    }
    if (Date.now() > deadline) throw new Error(`grid did not render; frames: ${page.frames().map((f) => f.url())}`)
    await new Promise((r) => setTimeout(r, 300))
  }
})

await browser.close().catch(() => {})
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
