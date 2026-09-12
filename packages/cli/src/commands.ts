// The four `@flownote/cli` commands (DESIGN.md §9.6) — `create`, `build`,
// `dev`, `pack`. Each exported function takes plain arguments (no argv
// parsing here — that's cli.ts) and does real filesystem/process work, so
// they're each independently unit-testable in a temp directory.
//
// Deliberately smaller than DESIGN.md §9.6 describes in two ways, both
// noted inline below and in this package's README:
//   - No Vite-based bundling. Every plugin file in this codebase (the
//     spreadsheet reference plugin included) is plain `tsc` output loaded
//     via a browser-native `<script type="module">` + import map, and that
//     already works end-to-end — adding a bundler would be new surface
//     with no current benefit, not a gap this pass fixes.
//   - `dev`'s "hot-reload" is rebuild-and-copy, not the postMessage-driven
//     iframe-destroy-and-recreate DESIGN.md's Developer sub-view describes
//     — that sub-view doesn't exist in the app yet (EXECUTION_PLAN.md
//     Phase 7 lists it as a known gap). Reloading FlowNote's window picks
//     up a rebuilt plugin; this just automates the copy step.
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { blockHtml, blockTs, indexTs, manifestJson, packageJson, readmeMd, TSCONFIG_JSON } from './templates'
import { createZip, type ZipEntry } from './zip'

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export function validatePluginName(name: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    return `invalid plugin name "${name}" — must start with a lowercase letter and contain only lowercase letters, digits, and hyphens`
  }
  return null
}

export interface CreateOptions {
  name: string
  /** Directory the new project folder is created under. Defaults to `process.cwd()`. */
  cwd?: string
}

/** Scaffolds a new plugin project at `<cwd>/<name>/`. Throws if the name is invalid or the directory already exists. */
export function createPlugin({ name, cwd = process.cwd() }: CreateOptions): string {
  const nameError = validatePluginName(name)
  if (nameError) throw new Error(nameError)

  const dir = path.join(cwd, name)
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`)

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'flownote-plugin.json'), manifestJson(name))
  fs.writeFileSync(path.join(dir, 'package.json'), packageJson(name))
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG_JSON)
  fs.writeFileSync(path.join(dir, 'README.md'), readmeMd(name))
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), indexTs(name))
  fs.writeFileSync(path.join(dir, 'src', 'block.html'), blockHtml())
  fs.writeFileSync(path.join(dir, 'src', 'block.ts'), blockTs(name))

  return dir
}

/** Resolves `tsc` the way `npx` would from `cwd` — the plugin project's own `node_modules/.bin/tsc` if present, else falls back to `npx tsc` (works even before `npm install` has run, or for a monorepo-nested plugin like `plugins/spreadsheet` that resolves it from a workspace root instead). */
function resolveTscCommand(cwd: string): { command: string; args: string[] } {
  const localTsc = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
  if (fs.existsSync(localTsc)) return { command: localTsc, args: [] }
  return { command: 'npx', args: ['tsc'] }
}

export interface BuildOptions {
  cwd?: string
}

/** Runs `tsc` in `cwd`. Returns the compiler's exit code (0 on success). */
export function buildPlugin({ cwd = process.cwd() }: BuildOptions = {}): number {
  const { command, args } = resolveTscCommand(cwd)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  return result.status ?? 1
}

interface Manifest {
  id: string
  name: string
  version: string
  permissions: string[]
  [key: string]: unknown
}

/** DESIGN.md §9.3's whitelist — mirrors `KNOWN_PERMISSIONS` in `crates/flownote-electron/src/protocol.rs`'s `install_plugin`. Kept in sync by hand (the two live in different languages/packages); a permission this list is missing will still be caught server-side at install time, just later than a `pack`-time check would prefer. */
const KNOWN_PERMISSIONS = ['storage:read', 'storage:write', 'clipboard:read', 'clipboard:write', 'network:fetch', 'theme:read']

function readManifest(cwd: string): Manifest {
  const manifestPath = path.join(cwd, 'flownote-plugin.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`no flownote-plugin.json in ${cwd}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest
  if (!manifest.id || !manifest.name || !manifest.version) {
    throw new Error('flownote-plugin.json must have id, name, and version')
  }
  for (const permission of manifest.permissions ?? []) {
    if (!KNOWN_PERMISSIONS.includes(permission)) {
      throw new Error(`unknown permission "${permission}" (expected one of: ${KNOWN_PERMISSIONS.join(', ')})`)
    }
  }
  return manifest
}

/** Every asset `pack`/`dev --install-into` ships for one plugin: its manifest, every compiled `dist/*.js`, and every static `src/*.html` — the same flat set `plugins/spreadsheet/README.md`'s manual install steps copy, laid out the way `PluginManager.tsx`'s `pluginAssetUrl()` expects to find them (all in one directory, no subfolders). */
function collectPluginFiles(cwd: string): { name: string; path: string }[] {
  const files: { name: string; path: string }[] = [{ name: 'flownote-plugin.json', path: path.join(cwd, 'flownote-plugin.json') }]

  const distDir = path.join(cwd, 'dist')
  if (fs.existsSync(distDir)) {
    for (const entry of fs.readdirSync(distDir)) {
      if (entry.endsWith('.js')) files.push({ name: entry, path: path.join(distDir, entry) })
    }
  }

  const srcDir = path.join(cwd, 'src')
  if (fs.existsSync(srcDir)) {
    for (const entry of fs.readdirSync(srcDir)) {
      if (entry.endsWith('.html')) files.push({ name: entry, path: path.join(srcDir, entry) })
    }
  }

  return files
}

export interface PackOptions {
  cwd?: string
  /** Output `.fnp` path. Defaults to `<name>-<version>.fnp` in `cwd`. */
  out?: string
}

/**
 * Zips the plugin's manifest + built assets into a `.fnp` file. Validates
 * the manifest first (required fields, permission whitelist) so a bad
 * manifest fails fast here rather than only at install time.
 *
 * Nothing in FlowNote consumes a `.fnp` yet — `install_plugin` (Rust) only
 * accepts a manifest JSON string today (EXECUTION_PLAN.md Phase 7 lists
 * ".fnp install" as a follow-up). This command still exists because
 * producing a real distributable artifact is useful on its own (checksums,
 * a stable filename, a single file to hand someone) even before the app
 * side can open one directly.
 */
export function packPlugin({ cwd = process.cwd(), out }: PackOptions = {}): string {
  const manifest = readManifest(cwd)
  const files = collectPluginFiles(cwd)
  if (files.length <= 1) {
    throw new Error(`no built assets found in ${cwd} — run "flownote build" first`)
  }

  const entries: ZipEntry[] = files.map((f) => ({ name: f.name, data: fs.readFileSync(f.path) }))
  const zip = createZip(entries)

  const outPath = out ?? path.join(cwd, `${manifest.name.toLowerCase().replace(/\s+/g, '-')}-${manifest.version}.fnp`)
  fs.writeFileSync(outPath, zip)
  return outPath
}

export interface DevOptions {
  cwd?: string
  /** A FlowNote checkout's `packages/frontend/public` directory — when given, every successful rebuild is copied into `<installInto>/plugins/<manifest.id>/` (create the dir, reload FlowNote's window to see the change). */
  installInto?: string
  /** Injectable for tests — real callers use `node:child_process`'s `spawn`. */
  spawnFn?: typeof spawn
}

/**
 * Runs `tsc --watch` in `cwd`; on every "Found 0 errors" compile (and once
 * up front if `dist/` already has files, e.g. resuming a session), copies
 * this plugin's built assets into `installInto` when given. Returns the
 * child process so the caller (cli.ts) can decide when to stop it — this
 * function doesn't block.
 */
export function devPlugin({ cwd = process.cwd(), installInto, spawnFn = spawn }: DevOptions = {}): ReturnType<typeof spawn> {
  const { command, args } = resolveTscCommand(cwd)
  const child = spawnFn(command, [...args, '--watch', '--preserveWatchOutput'], { cwd, stdio: ['ignore', 'pipe', 'inherit'] })

  const install = () => {
    if (!installInto) return
    try {
      const manifest = readManifest(cwd)
      const targetDir = path.join(installInto, 'plugins', manifest.id)
      fs.mkdirSync(targetDir, { recursive: true })
      for (const file of collectPluginFiles(cwd)) {
        fs.copyFileSync(file.path, path.join(targetDir, file.name))
      }
      // eslint-disable-next-line no-console -- this command's whole point is progress output
      console.log(`flownote dev: installed into ${targetDir} — reload FlowNote's window to pick it up`)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('flownote dev: install step failed:', err instanceof Error ? err.message : err)
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    process.stdout.write(text)
    if (/Found 0 errors\./.test(text)) install()
  })

  return child
}
