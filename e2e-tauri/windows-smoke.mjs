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
    await dumpDiagnostics(name)
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
const allPages = () => browser.contexts().flatMap((c) => c.pages())
/** The app's page. The DevTools port opens before WebView2 has navigated
 * to the app (the first page is `about:blank`), so poll for it. */
async function appPage(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const page = allPages().find((p) => p.url().includes('tauri.localhost'))
    if (page) return page
    if (Date.now() > deadline) throw new Error(`no tauri.localhost page after ${timeoutMs} ms; pages: ${allPages().map((p) => p.url())}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}
let page = await appPage()
await page.waitForSelector('[aria-label="New page"]', { timeout: 30_000 })

// Diagnostics: console output, page errors and failed/erroring requests
// from the app and its plugin iframes, printed when a check fails so a CI
// failure says *why* (e.g. a plugin script that didn't load).
const events = []
function watch(p) {
  p.on('console', (m) => events.push(`console.${m.type()} [${m.location()?.url ?? ''}] ${m.text()}`))
  p.on('pageerror', (e) => events.push(`pageerror ${e.message}`))
  p.on('requestfailed', (r) => events.push(`requestfailed ${r.url()} ${r.failure()?.errorText ?? ''}`))
  p.on('response', (r) => {
    if (r.status() >= 400) events.push(`http ${r.status()} ${r.url()}`)
  })
}
watch(page)
const ARTIFACTS = path.join(REPO, 'smoke-artifacts')
async function dumpDiagnostics(name) {
  console.log(`  --- diagnostics for "${name}" ---`)
  console.log(`  frames: ${page.frames().map((f) => f.url() || '(no url)').join(' | ')}`)
  for (const line of events.splice(0)) console.log(`  ${line}`)
  try {
    fs.mkdirSync(ARTIFACTS, { recursive: true })
    const file = path.join(ARTIFACTS, `${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`)
    await page.screenshot({ path: file, timeout: 10_000 })
    console.log(`  screenshot: ${file}`)
  } catch (e) {
    console.log(`  (no screenshot: ${e.message.split('\n')[0]})`)
  }
}

/** Runs a UI step, naming it in the error if it fails. */
async function step(name, fn) {
  try {
    return await fn()
  } catch (e) {
    throw new Error(`step "${name}": ${e.message.split('\n')[0]}`)
  }
}
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

// TEMPORARY probe: why does a sandboxed (opaque-origin) iframe's module
// script load from flownote-plugin fail CORS on WebView2?
await check('probe: plugin file fetch from the page and from iframes', async () => {
  const r = await page.evaluate(async () => {
    let url = 'http://flownote-plugin.localhost/plugins/com.sandeep.spreadsheet/index.js'
    const out = {}
    try {
      const res = await fetch(url, { cache: 'no-store' })
      out.page = `${res.status} acao=${res.headers.get('access-control-allow-origin')} type=${res.type}`
    } catch (e) {
      out.page = `threw ${e}`
    }
    const inFrame = (sandbox, mode) =>
      new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2)
        const f = document.createElement('iframe')
        if (sandbox !== null) f.setAttribute('sandbox', sandbox)
        const onMsg = (e) => {
          if (e.data?.probe !== id) return
          window.removeEventListener('message', onMsg)
          f.remove()
          resolve(e.data.result)
        }
        window.addEventListener('message', onMsg)
        setTimeout(() => resolve('timeout'), 10_000)
        f.srcdoc = `<script>
          fetch(${JSON.stringify(url)}, { mode: ${JSON.stringify(mode)}, cache: 'no-store' })
            .then((r) => 'origin=' + self.origin + ' ' + r.status + ' type=' + r.type + ' acao=' + r.headers.get('access-control-allow-origin'), (e) => 'origin=' + self.origin + ' threw ' + e)
            .then((result) => parent.postMessage({ probe: ${JSON.stringify(id)}, result }, '*'))
        </script>`
        document.body.appendChild(f)
      })
    out.sandboxedCors = await inFrame('allow-scripts', 'cors')
    out.sandboxedNoCors = await inFrame('allow-scripts', 'no-cors')
    out.sameOriginCors = await inFrame('allow-scripts allow-same-origin', 'cors')
    out.unsandboxedCors = await inFrame(null, 'cors')
    // Issue #33 variants (the app answers these only with FLOWNOTE_PROTOCOL_PROBE set).
    const base = url
    for (const q of ['acao=null', 'acao=echo', 'acao=echo&pna=1', 'pna=1']) {
      url = `${base}?${q}`
      out[`sandboxedCors ${q}`] = await inFrame('allow-scripts', 'cors')
    }
    url = base
    // A real module import (what the plugin does), with the most permissive variant.
    out.sandboxedImport = await new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      const f = document.createElement('iframe')
      f.setAttribute('sandbox', 'allow-scripts')
      const onMsg = (e) => {
        if (e.data?.probe !== id) return
        window.removeEventListener('message', onMsg)
        f.remove()
        resolve(e.data.result)
      }
      window.addEventListener('message', onMsg)
      setTimeout(() => resolve('timeout'), 10_000)
      f.srcdoc = `<script type="module">
        const tries = ['', '?acao=null', '?acao=echo&pna=1']
        const res = []
        for (const t of tries) {
          try { await import(${JSON.stringify(base)} + t + (t ? '&' : '?') + 'm=' + Math.random()); res.push(t + ':ok') } catch (e) { res.push(t + ':' + e) }
        }
        parent.postMessage({ probe: ${JSON.stringify(id)}, result: res.join(' | ') }, '*')
      </script>`
      document.body.appendChild(f)
    })
    try {
      out.handlerSaw = await (await fetch('http://flownote-plugin.localhost/__probe/log', { cache: 'no-store' })).json()
    } catch (e) {
      out.handlerSaw = `threw ${e}`
    }
    return out
  })
  console.log(`  probe: ${JSON.stringify(r, null, 1)}`)
  for (const line of events.splice(0)) console.log(`  ${line}`)
})

await check('spreadsheet plugin: loads after restart-equivalent reload, registers /sheet, grid renders', async () => {
  await invoke('install_plugin', { source: MANIFEST })
  await page.reload()
  const reloaded = await appPage()
  if (reloaded !== page) {
    page = reloaded
    watch(page)
  }
  await page.waitForSelector('[aria-label="New page"]', { timeout: 30_000 })
  // Loaded on startup, without opening the Plugins panel.
  await step('plugin iframe attached', () =>
    page.locator('iframe[sandbox="allow-scripts"]').first().waitFor({ state: 'attached', timeout: 15_000 }),
  )

  const t = { timeout: 15_000 }
  await step('open New page', () => page.getByRole('button', { name: 'New page' }).click(t))
  await step('choose New folder', () => page.getByRole('radio', { name: 'New folder' }).click(t))
  await step('name the folder', () => page.getByRole('textbox', { name: 'New folder name' }).fill('Sheets', t))
  await step('Next', () => page.getByRole('button', { name: 'Next' }).click(t))
  await step('name the file', () => page.getByRole('textbox', { name: 'File name' }).fill('Grid', t))
  await step('Create', () => page.getByRole('button', { name: 'Create' }).click(t))
  await step('click the canvas', () => page.getByTestId('canvas-root').click({ position: { x: 100, y: 100 }, ...t }))
  await page.keyboard.type('/')
  const menu = page.getByRole('menu', { name: 'Insert block' })
  await step('slash menu opens', () => menu.waitFor(t))
  await step('Spreadsheet in the slash menu', async () => {
    try {
      await menu.getByRole('menuitem', { name: 'Spreadsheet' }).click(t)
    } catch (e) {
      const items = await menu.getByRole('menuitem').allInnerTexts().catch(() => [])
      throw new Error(`${e.message.split('\n')[0]} — menu items: ${JSON.stringify(items)}`)
    }
  })

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

await check('the spreadsheet plugin (no network:fetch) can\'t reach the network from its grid', async () => {
  const http = await import('node:http')
  let hits = 0
  const server = http.createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' })
    res.end('pong')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    const grid = page.frames().find((f) => f.url().includes('grid.html'))
    if (!grid) throw new Error('no grid frame (the plugin check above must pass first)')
    const result = await grid.evaluate((u) => fetch(u).then((r) => r.text(), () => 'blocked'), url)
    expectEqual(result, 'blocked', 'fetch from the grid')
    expectEqual(hits, 0, 'requests that reached the server')
  } finally {
    server.close()
  }
})

await browser.close().catch(() => {})
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
