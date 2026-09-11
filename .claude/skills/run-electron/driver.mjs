// REPL driver for FlowNote's Electron shell (apps/electron). Run under a
// real X display or xvfb on headless Linux — see SKILL.md.
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output.
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// .claude/skills/run-electron -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../..')
const APP_DIR = path.join(REPO_ROOT, 'apps/electron')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

// `electron` isn't a root devDependency (only apps/electron's), so pnpm
// doesn't hoist/symlink it to the repo root — resolve it by walking
// node_modules/.pnpm rather than a plain `require.resolve`.
function resolvePnpmPackageDir(pkg, versionPrefix) {
  const base = path.join(REPO_ROOT, 'node_modules/.pnpm')
  const dir = fs.readdirSync(base).find((d) => d.startsWith(`${pkg}@${versionPrefix}`))
  if (!dir) throw new Error(`could not find ${pkg}@${versionPrefix}* under node_modules/.pnpm`)
  return path.join(base, dir, 'node_modules', pkg)
}

const electronBin = path.join(resolvePnpmPackageDir('electron', '32'), 'dist/electron')

let app = null
let page = null // the window/page you actually interact with

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    app = await electron.launch({
      executablePath: electronBin,
      // --no-sandbox: Electron's sandbox needs CAP_SYS_ADMIN/user namespaces,
      // absent in most containers. --disable-gpu/--disable-software-rasterizer:
      // without them, launch() hangs at native Chromium GPU init and times
      // out (~30s) with no error — this is the exact failure mode this repo's
      // EXECUTION_PLAN.md logged as "hangs at native Chromium startup" before
      // these flags were found.
      args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage', APP_DIR],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
      timeout: 60_000,
    })
    app.process().stdout.on('data', (d) => process.stdout.write('MAIN-OUT: ' + d))
    app.process().stderr.on('data', (d) => process.stdout.write('MAIN-ERR: ' + d))
    page = await app.firstWindow()
    page.on('console', (msg) => console.log('CONSOLE:', msg.type(), msg.text()))
    page.on('pageerror', (err) => console.log('PAGEERROR:', err.message))
    await new Promise((r) => setTimeout(r, 1_000))
    console.log('launched.', app.windows().length, 'windows:')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel)
    console.log('click', sel, '->', r)
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.tagName
    }, text)
    console.log('click-text', JSON.stringify(text), '->', r)
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 30 })
  },
  async press(key) {
    if (page) await page.keyboard.press(key)
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first')
    try {
      await page.waitForSelector(sel, { timeout: 10_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first')
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null))
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  // FlowNote-specific: fills the folder-picker + name fields to create a
  // new page, mirroring PageList.tsx's "New page" flow (DESIGN.md §2.2).
  async 'new-page'(args) {
    if (!page) return console.log('ERROR: launch first')
    const [folderName, fileName] = args.split(/\s+/)
    await page.locator('[aria-label="New page"]').click()
    await new Promise((r) => setTimeout(r, 200))
    await page.locator('select[aria-label="Existing folder"]').selectOption({ label: folderName })
    await page.locator('button:has-text("Next")').click()
    await new Promise((r) => setTimeout(r, 200))
    await page.locator('input[aria-label="File name"]').fill(fileName)
    await page.locator('button:has-text("Create")').click()
    console.log('new-page:', folderName, '/', fileName)
  },

  async 'new-folder'(name) {
    if (!page) return console.log('ERROR: launch first')
    await page.locator('[aria-label="New folder"]').click()
    await new Promise((r) => setTimeout(r, 200))
    await page.locator('input[aria-label="New folder name"]').fill(name)
    await page.keyboard.press('Enter')
    console.log('new-folder:', name)
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  },
}

// Stop Electron from stealing stdin - use the raw fd.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return rl.prompt()
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log('unknown:', cmd, ' - try: help')
    return rl.prompt()
  }
  try {
    await fn(rest.join(' '))
  } catch (e) {
    console.log('ERROR:', e.message)
  }
  if (cmd === 'quit') {
    rl.close()
    process.exit(0)
  }
  rl.prompt()
})
rl.on('close', async () => {
  await COMMANDS.quit()
  process.exit(0)
})

console.log('FlowNote electron driver - "help" for commands, "launch" to start')
rl.prompt()
