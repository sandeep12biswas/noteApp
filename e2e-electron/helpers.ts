// Shared launch/drive helpers for the Electron-hosted plugin E2E suite.
// Mirrors `.claude/skills/run-electron/driver.mjs`'s launch recipe (same
// flags, same reasons — see that file's comments) but returns a real
// Playwright `Page`/`ElectronApplication` pair for use directly in
// `@playwright/test` specs, and points `--user-data-dir` at a fresh temp
// directory per launch so specs never see another run's (or the
// `run-electron` skill's own) leftover SQLite state.
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import type { Frame } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// e2e-electron -> repo root
export const REPO_ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(REPO_ROOT, 'apps/electron')

function resolvePnpmPackageDir(pkg: string, versionPrefix: string): string {
  const base = path.join(REPO_ROOT, 'node_modules/.pnpm')
  const dir = fs.readdirSync(base).find((d) => d.startsWith(`${pkg}@${versionPrefix}`))
  if (!dir) throw new Error(`could not find ${pkg}@${versionPrefix}* under node_modules/.pnpm`)
  return path.join(base, dir, 'node_modules', pkg)
}

const electronBin = path.join(resolvePnpmPackageDir('electron', '32'), 'dist/electron')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

/**
 * Launches the app with a fresh temp `--user-data-dir` (so a fresh SQLite
 * file), or reuses one passed via `userDataDir` — for a spec verifying
 * something survives a full app *restart* against the same on-disk
 * database (`ink-layer-persistence.spec.ts`): close the first `LaunchedApp`
 * with `app.close()` directly (not `closeApp`, which deletes the
 * directory), then relaunch with `{ userDataDir: previous.userDataDir }`.
 */
export async function launchApp(options?: { userDataDir?: string }): Promise<LaunchedApp> {
  const userDataDir = options?.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-e2e-'))
  const app = await electron.launch({
    executablePath: electronBin,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      `--user-data-dir=${userDataDir}`,
      APP_DIR,
    ],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="canvas-root"], [aria-label="New page"]', { timeout: 15_000 })
  return { app, page, userDataDir }
}

export async function closeApp({ app, userDataDir }: LaunchedApp): Promise<void> {
  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}

/** Same "no folder/page yet" flow `e2e/helpers.ts` drives against the browser-only build. */
export async function createFolderAndPage(page: Page, folderName: string, pageName: string): Promise<void> {
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByRole('radio', { name: 'New folder' }).click()
  await page.getByRole('textbox', { name: 'New folder name' }).fill(folderName)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('textbox', { name: 'File name' }).fill(pageName)
  await page.getByRole('button', { name: 'Create' }).click()
}

export async function clickCanvasAt(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByTestId('canvas-root')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas-root has no bounding box')
  await page.mouse.click(box.x + x, box.y + y)
}

export const SPREADSHEET_MANIFEST = fs.readFileSync(path.join(REPO_ROOT, 'plugins/spreadsheet/flownote-plugin.json'), 'utf-8')

/**
 * The spreadsheet block's own per-instance iframe (`grid.html`) is a real
 * sandboxed (`allow-scripts`, no `allow-same-origin`) cross-origin OOPIF —
 * driving it through Playwright's normal locator actions (`.fill()`,
 * `.dispatchEvent()`) against a `frameLocator` was found live to hang
 * unreliably in this container (no GPU, software rendering), even though
 * the same frame's DOM is perfectly readable/writable via `Frame.evaluate`.
 * These helpers are the reliable path for driving it; prefer them over
 * `page.frameLocator(...)` for anything beyond visibility assertions.
 */
export function findGridFrame(page: Page): Frame {
  const frame = page.frames().find((f) => f.url().includes('grid.html'))
  if (!frame) throw new Error('no grid.html iframe found — is the spreadsheet block rendered?')
  return frame
}

/** `findGridFrame`, but waits for the frame's own navigation to land — the host `<iframe>` element mounting doesn't mean its child frame has attached to `page.frames()` yet. */
export async function waitForGridFrame(page: Page, timeoutMs = 10_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const frame = page.frames().find((f) => f.url().includes('grid.html'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('no grid.html iframe found — is the spreadsheet block rendered?')
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function setGridCell(frame: Frame, row: number, col: number, value: string): Promise<void> {
  await frame.evaluate(
    ({ row, col, value }) => {
      const inputs = document.querySelectorAll('table tr')[row]?.querySelectorAll('input')
      const input = inputs?.[col]
      if (!input) throw new Error(`no input at [${row},${col}]`)
      input.value = value
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { row, col, value },
  )
}

export async function readGridCell(frame: Frame, row: number, col: number): Promise<string> {
  return frame.evaluate(
    ({ row, col }) => {
      const inputs = document.querySelectorAll('table tr')[row]?.querySelectorAll('input')
      const input = inputs?.[col] as HTMLInputElement | undefined
      return input?.value ?? ''
    },
    { row, col },
  )
}
