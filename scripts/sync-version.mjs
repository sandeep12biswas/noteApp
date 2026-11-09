#!/usr/bin/env node
// Copies the root VERSION file into every place a release version is baked
// in, so the Linux (Electron) and Windows (Tauri) packages always ship the
// same number. Run by scripts/linux/package.sh and scripts/windows/package.ps1;
// safe to run by hand: `node scripts/sync-version.mjs [--check]`.
// --check exits 1 (changing nothing) if any file is out of date.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`VERSION must be semver (x.y.z), got '${version}'`)
  process.exit(2)
}
const check = process.argv.includes('--check')

const jsonFiles = ['apps/electron/package.json', 'apps/tauri/package.json', 'apps/tauri/src-tauri/tauri.conf.json']
const cargoFiles = [
  'crates/flownote-core/Cargo.toml',
  'crates/flownote-electron/Cargo.toml',
  'crates/flownote-tauri/Cargo.toml',
  'apps/tauri/src-tauri/Cargo.toml',
]

let stale = 0
function update(rel, before, after) {
  if (before === after) return
  stale++
  if (check) console.log(`out of date: ${rel}`)
  else {
    writeFileSync(join(root, rel), after)
    console.log(`updated ${rel} -> ${version}`)
  }
}

for (const rel of jsonFiles) {
  const text = readFileSync(join(root, rel), 'utf8')
  // Replace only the top-level "version" line, keeping the file's formatting.
  update(rel, text, text.replace(/^(\s{2}"version":\s*")[^"]*(")/m, `$1${version}$2`))
}
for (const rel of cargoFiles) {
  const text = readFileSync(join(root, rel), 'utf8')
  // The first `version = ` line belongs to [package].
  update(rel, text, text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`))
}

if (check && stale) process.exit(1)
if (!stale) console.log(`all versions already ${version}`)
