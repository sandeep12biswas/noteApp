#!/usr/bin/env node
// Captures the screenshots used by the FlowNote User Guide and Feature Guide
// (docs/guides/*.html -> docs/*.pdf) from the real Electron app.
//
//   node docs/guides/capture-screenshots.mjs        (or: pnpm docs:screenshots)
//
// Needs a built app (pnpm --filter @flownote/frontend build, pnpm --filter
// @flownote/electron build, cargo build --release -p flownote-electron — or
// scripts/linux/package.sh) and an X display ($DISPLAY, else run under
// `xvfb-run -a`). Launches with a fresh, temporary --user-data-dir, the same
// recipe as e2e-electron/helpers.ts, so your own notes are never touched; it
// seeds sample notes, then walks through each feature and saves
// docs/guides/screenshots/<name>.png. A step that fails is reported and
// skipped, so one broken flow doesn't block the rest.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(REPO, 'docs/guides/screenshots')
const require = createRequire(path.join(REPO, 'package.json'))
const { _electron: electron } = require('playwright-core')

const pnpmDir = path.join(REPO, 'node_modules/.pnpm')
const electronDir = fs.readdirSync(pnpmDir).find((d) => d.startsWith('electron@32'))
if (!electronDir) throw new Error('electron@32 not installed (run pnpm install)')
const electronBin = path.join(pnpmDir, electronDir, 'node_modules/electron/dist/electron')
const SPREADSHEET_MANIFEST = fs.readFileSync(path.join(REPO, 'plugins/spreadsheet/flownote-plugin.json'), 'utf8')

fs.mkdirSync(OUT, { recursive: true })
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-docs-'))
const app = await electron.launch({
  executablePath: electronBin,
  // Same flags as e2e-electron/helpers.ts (GPU init hangs without them).
  args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage', `--user-data-dir=${userDataDir}`, path.join(REPO, 'apps/electron')],
  // Window buttons on the right, as most readers (Windows, default Linux
  // desktops) see them — not wherever this machine's desktop puts them.
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', FLOWNOTE_TITLEBAR_BUTTONS: ':minimize,maximize,close' },
  timeout: 60_000,
})
const page = await app.firstWindow()
await page.waitForSelector('[aria-label="New page"]', { timeout: 20_000 })
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.setSize(1400, 880)
  w.center()
})

const wait = (ms = 300) => page.waitForTimeout(ms)
const results = []

/** Runs one capture step; failures are logged and skipped. */
async function step(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok    ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message ?? e).split('\n')[0] })
    console.log(`  SKIP  ${name}: ${String(e.message ?? e).split('\n')[0]}`)
    await page.keyboard.press('Escape').catch(() => {})
  }
}

/**
 * Screenshot of the whole window, or of `locator` (plus `pad` px around it),
 * optionally limited to `maxWidth` x `maxHeight` CSS px from its top-left
 * (`alignRight` keeps the right edge instead), or widened to `minWidth`.
 */
async function shot(name, locator, pad = 0, { maxWidth = Infinity, maxHeight = Infinity, minWidth = 0, alignRight = false } = {}) {
  const file = path.join(OUT, `${name}.png`)
  if (!locator) return page.screenshot({ path: file })
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${name}: element not visible`)
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  let x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  let width = Math.max(minWidth, Math.min(maxWidth, box.width + 2 * pad))
  if (alignRight && width < box.width + 2 * pad) x = box.x + box.width + pad - width
  width = Math.min(vp.w - x, width)
  const height = Math.min(vp.h - y, maxHeight, box.height + 2 * pad)
  return page.screenshot({ path: file, clip: { x, y, width, height } })
}

const folderButton = (name) => page.getByRole('list', { name: 'Folder tree' }).getByRole('button', { name, exact: true })
const fileButton = (name) => page.getByRole('list', { name: 'Files' }).getByRole('button', { name, exact: true })
const tab = (name) => page.getByRole('tab', { name })
const canvas = () => page.getByTestId('canvas-root')

async function clickCanvasAt(x, y) {
  const box = await canvas().boundingBox()
  await page.mouse.click(box.x + x, box.y + y)
  await wait(250)
}

const segments = () => page.locator('[data-testid^="segment-"][aria-label="Segment"]')

/** Click empty canvas at (x, y), focus the new segment, then run `fn` to type into it. */
async function writeSegment(x, y, fn) {
  await tab('Home').click()
  const before = await segments().count()
  await clickCanvasAt(x, y)
  const deadline = Date.now() + 5000
  while ((await segments().count()) <= before) {
    if (Date.now() > deadline) throw new Error(`clicking the canvas at ${x},${y} made no new segment (inside an existing one?)`)
    await wait(100)
  }
  const seg = segments().nth(before)
  // New segments don't take focus by themselves (run-electron SKILL.md).
  // Click near the top-left: a wide segment's centre can be off-screen.
  await seg.locator('.ProseMirror').click({ position: { x: 12, y: 8 } })
  await fn(seg)
  return seg
}

/** Drags a segment's resize handle so it is `width` CSS px wide. */
async function setSegmentWidth(seg, width) {
  await seg.locator('.ProseMirror').click({ position: { x: 12, y: 8 } })
  await seg.hover()
  const handle = seg.locator('[aria-label="Resize segment"]')
  await handle.waitFor({ timeout: 3000 })
  const hb = await handle.boundingBox()
  const sb = await seg.boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + width, hb.y + hb.height / 2, { steps: 8 })
  await page.mouse.up()
  await wait(300)
}

async function newPage(folder, name) {
  await page.getByRole('button', { name: 'New page' }).click()
  await wait(200)
  await page.locator('select[aria-label="Existing folder"]').selectOption({ label: folder })
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  await wait(400)
}

async function newFolder(name) {
  await page.getByRole('button', { name: 'New folder' }).click()
  await wait(150)
  await page.getByRole('textbox', { name: 'New folder name' }).fill(name)
  await page.keyboard.press('Enter')
  await wait(250)
}

async function setTheme(want) {
  const toggle = page.getByRole('button', { name: /^Theme: / })
  for (let i = 0; i < 4; i++) {
    const label = (await toggle.getAttribute('aria-label')) ?? ''
    if (label.startsWith(`Theme: ${want}`)) return
    await toggle.click()
    await wait(200)
  }
  throw new Error(`could not switch theme to ${want}`)
}

async function slash(itemName) {
  await page.keyboard.type('/')
  const menu = page.getByRole('menu', { name: 'Insert block' })
  await menu.waitFor()
  await menu.getByRole('menuitem', { name: itemName, exact: true }).click()
  await wait(150)
}

console.log(`Capturing into ${path.relative(REPO, OUT)}/ (profile: ${userDataDir})`)
await setTheme('light')

// ---------------------------------------------------------------- start
await step('01-first-launch', () => shot('01-first-launch'))

await step('02-new-page-dialog', async () => {
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('radio', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill('work')
  await wait(200)
  await shot('02-new-page-dialog', page.getByRole('dialog', { name: 'New page' }), 12)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill('Meeting notes')
  await wait(150)
  await shot('03-new-page-name', page.getByRole('dialog', { name: 'New page' }), 12)
  await page.getByRole('button', { name: 'Create' }).click()
  await wait(500)
})

await step('04-new-folder', async () => {
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill('personal')
  await wait(200)
  await shot('04-new-folder', page.getByTestId('section-sidebar'), 0, { maxHeight: 260 })
  await page.keyboard.press('Enter')
  await wait(250)
})

// Sample content: folders, a sub-folder, pages.
await step('seed-structure', async () => {
  await newFolder('Projects')
  await folderButton('Work').click()
  await page.getByRole('button', { name: 'New subfolder in Work' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Clients')
  await page.keyboard.press('Enter')
  await wait(250)
  await newPage('Work', 'Roadmap')
  await newPage('Work', 'Ideas 10')
  await newPage('Work', 'Ideas 2')
  await newPage('Personal', 'Recipes')
  await newPage('Projects', 'Garden plan')
  await folderButton('Work').click()
  await fileButton('Meeting notes').click()
  await wait(400)
})

// The meeting-notes page: three segments placed freely on the canvas.
await step('seed-meeting-notes', async () => {
  await writeSegment(40, 30, async () => {
    await page.getByRole('button', { name: 'Heading 1' }).click()
    await page.keyboard.type('Weekly sync')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Attendees: Anna, Ben, Maria')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Heading 3' }).click()
    await page.keyboard.type('Agenda')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Bulleted list' }).click()
    await page.keyboard.type('Release 0.1 status')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Installer feedback')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Sync roll-out plan')
  })
  await setSegmentWidth(segments().first(), 460)
  await writeSegment(520, 40, async () => {
    await page.getByRole('button', { name: 'Heading 3' }).click()
    await page.keyboard.type('Action items')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Checklist' }).click()
    await page.keyboard.type('Publish the user guide')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Test the Windows installer')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Collect feedback')
  })
  await setSegmentWidth(segments().nth(1), 380)
  await writeSegment(40, 330, async () => {
    await page.keyboard.type('Decisions are ')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.type('final')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.type(' once they are written in this box. ')
    await page.keyboard.press('ControlOrMeta+i')
    await page.keyboard.type('Click anywhere')
    await page.keyboard.press('ControlOrMeta+i')
    await page.keyboard.type(' on the page to start another note.')
  })
  await setSegmentWidth(segments().nth(2), 460)
  // Give the action-items segment a colour (right-click -> swatch).
  const seg = page.locator('[data-testid^="segment-"][aria-label="Segment"]').nth(1)
  const box = await seg.boundingBox()
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 6, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Segment colour' })
  await menu.waitFor()
  await menu.getByRole('menuitemradio').nth(2).click()
  await page.mouse.click(1000, 18) // deselect: empty part of the ribbon's tab row
  await page.keyboard.press('Escape')
  await wait(400)
})

await step('05-main-window', () => shot('05-main-window'))

// ----------------------------------------------------------- folders
await step('06-folder-context-menu', async () => {
  await folderButton('Work').click({ button: 'right' })
  await wait(250)
  await shot('06-folder-context-menu', page.getByTestId('section-sidebar'), 0, { minWidth: 380, maxHeight: 300 })
  await page.keyboard.press('Escape')
})

await step('07-folder-icon-menu', async () => {
  await page.getByRole('button', { name: 'Change icon for Projects' }).click()
  await wait(250)
  const menu = page.getByRole('menu', { name: 'Folder icon' }).or(page.getByRole('dialog', { name: 'Folder icon' }))
  const box = await menu.first().boundingBox()
  const side = await page.getByTestId('section-sidebar').boundingBox()
  await page.screenshot({
    path: path.join(OUT, '07-folder-icon-menu.png'),
    clip: { x: 0, y: side.y, width: Math.max(side.width, box.x + box.width + 12), height: Math.max(box.y + box.height + 12 - side.y, 300) },
  })
  // Pick a lavender icon so the tree shows a custom one from now on.
  await menu.first().getByRole('menuitemradio', { name: 'Icon Work' }).click().catch(() => page.keyboard.press('Escape'))
})

await step('08-pages-natural-order', async () => {
  await folderButton('Work').click()
  await wait(250)
  await shot('08-pages-natural-order', page.getByTestId('page-list'), 0, { maxHeight: 260 })
})

// ------------------------------------------------------------ canvas
await step('09-segment-handles', async () => {
  const seg = page.locator('[data-testid^="segment-"][aria-label="Segment"]').first()
  await seg.locator('.ProseMirror').click()
  await seg.hover()
  await wait(300)
  await shot('09-segment-handles', canvas().locator('..'), 0)
})

await step('10-segment-colour-menu', async () => {
  const seg = page.locator('[data-testid^="segment-"][aria-label="Segment"]').nth(2)
  const box = await seg.boundingBox()
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 4, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Segment colour' })
  await menu.waitFor()
  const mb = await menu.boundingBox()
  await page.screenshot({
    path: path.join(OUT, '10-segment-colour-menu.png'),
    clip: { x: box.x - 10, y: box.y - 10, width: Math.max(box.width, mb.x + mb.width - box.x) + 20, height: Math.max(box.height, mb.y + mb.height - box.y) + 20 },
  })
  await page.keyboard.press('Escape')
})

await step('10b-delete-segment-undo', async () => {
  // A throwaway segment, deleted and then dismissed, so the sample notes stay as they are.
  await writeSegment(40, 560, async () => {
    await page.keyboard.type('Draft idea, no longer needed')
  })
  await page.mouse.click(1000, 18) // deselect: empty part of the ribbon's tab row
  await wait(200)
  const seg = segments().filter({ hasText: 'Draft idea, no longer needed' })
  await seg.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Segment colour' })
  await menu.getByRole('menuitem', { name: 'Delete segment' }).click()
  const toast = page.getByTestId('undo-delete-toast')
  await toast.waitFor()
  await wait(1200) // let the countdown bar run down a little
  await shot('10b-delete-segment-undo', page.getByTestId('editor-pane'))
  await toast.getByRole('button', { name: 'Dismiss' }).click()
  await wait(200)
})

await step('11-ribbon-home', () => shot('11-ribbon-home', page.getByTestId('ribbon-root')))

await step('12-text-colour-menu', async () => {
  const seg = page.locator('[data-testid^="segment-"][aria-label="Segment"]').nth(2)
  await seg.locator('.ProseMirror').dblclick()
  await page.getByRole('button', { name: 'Text colour options' }).click()
  await wait(250)
  await shot('12-text-colour-menu', page.locator('header'), 0).catch(() => {})
  const menu = page.getByRole('menu').last()
  const mb = await menu.boundingBox()
  await page.screenshot({ path: path.join(OUT, '12-text-colour-menu.png'), clip: { x: 0, y: 0, width: 1100, height: mb.y + mb.height + 12 } })
  await page.keyboard.press('Escape')
})

await step('seed-second-page', async () => {
  await fileButton('Roadmap').click()
  await wait(400)
})

await step('13-slash-menu', async () => {
  await writeSegment(40, 30, async () => {
    await page.getByRole('button', { name: 'Heading 2' }).click()
    await page.keyboard.type('Roadmap')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
  })
  const menu = page.getByRole('menu', { name: 'Insert block' })
  await menu.waitFor()
  await wait(200)
  const mb = await menu.boundingBox()
  const cb = await canvas().boundingBox()
  await page.screenshot({ path: path.join(OUT, '13-slash-menu.png'), clip: { x: cb.x, y: cb.y, width: 620, height: mb.y + mb.height - cb.y + 16 } })
  await menu.getByRole('menuitem', { name: 'Numbered list', exact: true }).click()
  await page.keyboard.type('Q1: installers and guides')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Q2: sync for everyone')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Q3: more plugins')
  await setSegmentWidth(segments().first(), 460)
})

await step('14-code-block', async () => {
  await writeSegment(40, 230, async () => {
    await slash('Code block')
    await page.keyboard.type('def add(a, b):\n    return a + b')
    await page.getByRole('combobox', { name: 'Code language' }).selectOption('python')
  })
  await wait(300)
  const seg = page.locator('[data-testid^="segment-"][aria-label="Segment"]').last()
  await shot('14-code-block', seg, 16)
})

await step('15-embedded-image', async () => {
  // A pasted screenshot (image on the clipboard) embeds straight away.
  await writeSegment(520, 30, async () => {
    await page.keyboard.type('Mock-up:')
    await page.keyboard.press('Enter')
    await app.evaluate(({ clipboard, nativeImage }, iconPath) => {
      clipboard.writeImage(nativeImage.createFromPath(iconPath).resize({ width: 160 }))
    }, path.join(REPO, 'apps/electron/build/icons/256x256.png'))
    await page.keyboard.press('ControlOrMeta+v')
  })
  await page.locator('[data-testid^="segment-"] img').first().waitFor({ timeout: 5000 })
  await wait(500)
  const seg = page.locator('[data-testid^="segment-"][aria-label="Segment"]').last()
  await setSegmentWidth(seg, 380)
  await shot('15-embedded-image', seg, 16)
})

// ------------------------------------------------------------- ribbon tabs
await step('16-ribbon-insert-ai', async () => {
  await tab('Insert').click()
  await wait(200)
  await shot('16-ribbon-insert-ai', page.getByTestId('ribbon-root'), 0, { maxWidth: 640 })
})

await step('17-ai-settings', async () => {
  await page.getByRole('button', { name: 'AI settings' }).click()
  await wait(300)
  const dlg = page.getByRole('dialog', { name: 'AI settings' })
  await dlg.waitFor()
  await shot('17-ai-settings', dlg, 12)
  await page.getByRole('button', { name: 'Close AI settings' }).click()
})

await step('18-draw-ink', async () => {
  await fileButton('Ideas 2').click()
  await wait(400)
  await writeSegment(40, 30, async () => {
    await page.getByRole('button', { name: 'Heading 2' }).click()
    await page.keyboard.type('Sketch')
  })
  await tab('Draw').click()
  await wait(200)
  const ink = page.getByTestId('ink-layer')
  const box = await ink.boundingBox()
  const stroke = async (pts) => {
    await page.mouse.move(box.x + pts[0][0], box.y + pts[0][1])
    await page.mouse.down()
    for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 6 })
    await page.mouse.up()
  }
  // A little house and a sun.
  await stroke([[120, 320], [120, 200], [200, 140], [280, 200], [280, 320], [120, 320]])
  await stroke([[180, 320], [180, 260], [220, 260], [220, 320]])
  await page.getByRole('button', { name: 'Colour #d97706' }).click()
  const sun = []
  for (let a = 0; a <= 360; a += 20) sun.push([420 + 40 * Math.cos((a * Math.PI) / 180), 170 + 40 * Math.sin((a * Math.PI) / 180)])
  await stroke(sun)
  await page.getByRole('button', { name: 'Colour #2563eb' }).click()
  await stroke([[60, 340], [160, 336], [260, 342], [360, 336], [480, 340]])
  await wait(300)
  await shot('18-draw-ink')
})

await step('19-view-page-colour', async () => {
  await tab('View').click()
  await page.getByRole('button', { name: 'Page colour' }).click()
  const menu = page.getByRole('menu', { name: 'Page colour' })
  await menu.waitFor()
  await wait(200)
  const mb = await menu.boundingBox()
  await page.screenshot({ path: path.join(OUT, '19-view-page-colour.png'), clip: { x: 0, y: 0, width: Math.max(900, mb.x + mb.width + 16), height: mb.y + mb.height + 16 } })
  await menu.getByRole('menuitemradio', { name: 'This page Mint' }).click()
  await wait(300)
})

await step('19b-colour-wheel', async () => {
  await tab('View').click()
  await page.getByRole('button', { name: 'Page colour' }).click()
  const menu = page.getByRole('menu', { name: 'Page colour' })
  await menu.getByRole('menuitem', { name: 'More colours…' }).click()
  await menu.getByRole('textbox', { name: 'Hex colour' }).fill('#7dd3fc')
  await wait(200)
  await shot('19b-colour-wheel', menu, 8)
  await menu.getByRole('menuitem', { name: 'Cancel' }).click()
  await page.keyboard.press('Escape')
  await wait(200)
})

await step('20-contrast-notice', async () => {
  // Its own page, so Adjust doesn't change the other sample notes.
  await fileButton('Ideas 10').click()
  await wait(400)
  await tab('View').click()
  await page.getByRole('button', { name: 'Page colour' }).click()
  // A dark custom page colour makes the blue text hard to read, so the notice offers to fix it.
  const colourMenu = page.getByRole('menu', { name: 'Page colour' })
  await colourMenu.getByRole('menuitem', { name: 'More colours…' }).click()
  await colourMenu.getByRole('textbox', { name: 'Hex colour' }).fill('#1e3a8a')
  await colourMenu.getByRole('menuitem', { name: 'Apply' }).click()
  await writeSegment(40, 30, async () => {
    await page.getByRole('button', { name: 'Heading 2' }).click()
    await page.keyboard.type('Night notes')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Blue text on a navy page is hard to read.')
  })
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Text colour options' }).click()
  await page.getByRole('menuitemradio', { name: 'Text colour #2563eb' }).click()
  await page.getByTestId('contrast-notice').waitFor({ timeout: 5000 })
  await page.mouse.click(1000, 18) // deselect: empty part of the ribbon's tab row
  await page.keyboard.press('Escape')
  await wait(300)
  await shot('20-contrast-notice')
  await page.getByTestId('contrast-notice').getByRole('button', { name: 'Adjust' }).click()
  await wait(400)
  await shot('20b-contrast-adjusted', segments().first(), 16)
})

// ---------------------------------------------------------------- search
await step('21-search-name', async () => {
  await page.getByRole('textbox', { name: 'Search pages' }).fill('ideas')
  await wait(500)
  await shot('21-search-name', page.getByTestId('page-list'), 0, { maxHeight: 220 })
})

await step('22-search-contents', async () => {
  await page.locator('select[aria-label="Search mode"]').selectOption({ label: 'Contents' })
  await page.getByRole('textbox', { name: 'Search pages' }).fill('installer')
  await wait(800)
  await shot('22-search-contents', page.getByTestId('page-list'), 0, { maxHeight: 220 })
  await page.getByRole('textbox', { name: 'Search pages' }).fill('')
  await page.locator('select[aria-label="Search mode"]').selectOption({ label: 'Name' })
  await wait(300)
})

// ---------------------------------------------------------------- views
await step('23-linear-mode', async () => {
  await folderButton('Work').click()
  await fileButton('Meeting notes').click()
  await wait(300)
  await page.getByRole('button', { name: 'Switch to linear mode' }).click()
  await wait(500)
  await shot('23-linear-mode')
  await page.getByRole('button', { name: 'Switch to canvas mode' }).click()
  await wait(300)
})

await step('24-dark-theme', async () => {
  await setTheme('dark')
  await wait(400)
  await shot('24-dark-theme')
  await setTheme('light')
})

await step('25-status-bar', () => shot('25-status-bar', page.getByTestId('status-bar'), 0, { maxWidth: 420, alignRight: true }))

// --------------------------------------------------------------- plugins
await step('26-plugin-manager', async () => {
  await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
  await page.getByTestId('plugin-manager-ui').waitFor()
  await page.getByRole('button', { name: 'Install…' }).click()
  await page.getByRole('textbox', { name: 'Plugin manifest JSON' }).fill(SPREADSHEET_MANIFEST)
  await wait(200)
  await shot('26-plugin-install', page.getByTestId('plugin-manager-ui'), 8, { maxWidth: 820, maxHeight: 260 })
  await page.getByRole('button', { name: 'Install', exact: true }).click()
  await page.getByRole('list', { name: 'Installed plugins' }).getByRole('listitem').filter({ hasText: 'Spreadsheet' }).waitFor()
  await wait(300)
  await shot('27-plugin-manager', page.getByTestId('plugin-manager-ui'), 8, { maxHeight: 130 })
  await page.getByTestId('plugins-tab').getByRole('button', { name: 'Plugins' }).click()
  await wait(300)
})

await step('28-spreadsheet-block', async () => {
  await folderButton('Projects').click()
  await fileButton('Garden plan').click()
  await wait(400)
  await writeSegment(40, 30, async () => {
    await page.getByRole('button', { name: 'Heading 2' }).click()
    await page.keyboard.type('Garden budget')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    const menu = page.getByRole('menu', { name: 'Insert block' })
    await menu.waitFor()
    await menu.getByRole('menuitem', { name: 'Spreadsheet' }).click()
  })
  const block = page.getByTestId(/^plugin-block-/).first()
  await block.locator('iframe').waitFor()
  // Fill a few cells through the sandboxed frame (see e2e-electron/helpers.ts).
  const deadline = Date.now() + 10_000
  let frame
  while (!(frame = page.frames().find((f) => f.url().includes('grid.html'))) && Date.now() < deadline) await wait(100)
  if (frame) {
    const cells = [['Item', 'Cost'], ['Seeds', '12'], ['Soil', '30'], ['Tools', '45']]
    await frame.evaluate((cells) => {
      const rows = document.querySelectorAll('table tr')
      cells.forEach((r, i) => r.forEach((v, j) => {
        const input = rows[i]?.querySelectorAll('input')[j]
        if (input) { input.value = v; input.dispatchEvent(new Event('change', { bubbles: true })) }
      }))
    }, cells)
  }
  await wait(600)
  await shot('28-spreadsheet-block', page.locator('[data-testid^="segment-"][aria-label="Segment"]').first(), 16)
})

// ----------------------------------------------------------------- sync
await step('29-sync-settings', async () => {
  await tab('View').click()
  await page.getByRole('button', { name: 'Sync settings' }).click()
  const dlg = page.getByRole('dialog', { name: 'Sync settings' })
  await dlg.waitFor()
  await wait(300)
  await shot('29-sync-settings', dlg, 12)
  await page.getByRole('button', { name: 'Close sync settings' }).click()
  await tab('Home').click()
})

await step('30-final-overview', async () => {
  await folderButton('Work').click()
  await fileButton('Meeting notes').click()
  await page.mouse.click(1000, 18)
  await wait(500)
  await shot('30-final-overview')
})

await app.close()
fs.rmSync(userDataDir, { recursive: true, force: true })

const ok = results.filter((r) => r.ok && !r.name.startsWith('seed')).length
const skipped = results.filter((r) => !r.ok)
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ captured: new Date().toISOString(), results }, null, 2) + '\n')
console.log(`\n${ok} screenshot steps captured, ${skipped.length} skipped${skipped.length ? ': ' + skipped.map((s) => s.name).join(', ') : ''}`)
