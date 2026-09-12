import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPlugin, createPlugin, devPlugin, packPlugin, validatePluginName } from './commands'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-cli-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('validatePluginName', () => {
  it('accepts a lowercase-hyphenated name', () => {
    expect(validatePluginName('my-spreadsheet-plugin')).toBeNull()
  })

  it.each(['My-Plugin', '1-plugin', 'plugin name', 'plugin_name', ''])('rejects "%s"', (name) => {
    expect(validatePluginName(name)).not.toBeNull()
  })
})

describe('createPlugin', () => {
  it('scaffolds every expected file with valid manifest/package.json content', () => {
    const dir = createPlugin({ name: 'my-plugin', cwd: tmpDir })
    expect(dir).toBe(path.join(tmpDir, 'my-plugin'))

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'flownote-plugin.json'), 'utf-8'))
    expect(manifest).toMatchObject({
      id: 'com.example.my-plugin',
      name: 'My Plugin',
      entry: 'index.js',
      permissions: [],
      extensionPoints: [],
    })

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('@flownote-plugins/my-plugin')
    expect(pkg.dependencies['@flownote/sdk']).toMatch(/^\^/)

    for (const file of ['tsconfig.json', 'README.md', 'src/index.ts', 'src/block.html', 'src/block.ts']) {
      expect(fs.existsSync(path.join(dir, file)), `expected ${file} to exist`).toBe(true)
    }
    expect(fs.readFileSync(path.join(dir, 'src/index.ts'), 'utf-8')).toContain("registerBlockType")
    expect(fs.readFileSync(path.join(dir, 'src/index.ts'), 'utf-8')).toContain("'/my-plugin'")
  })

  it('rejects an invalid name before touching the filesystem', () => {
    expect(() => createPlugin({ name: 'My Plugin', cwd: tmpDir })).toThrow(/invalid plugin name/)
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })

  it('refuses to overwrite an existing directory', () => {
    createPlugin({ name: 'my-plugin', cwd: tmpDir })
    expect(() => createPlugin({ name: 'my-plugin', cwd: tmpDir })).toThrow(/already exists/)
  })
})

describe('packPlugin', () => {
  function writeManifest(dir: string, overrides: Record<string, unknown> = {}) {
    fs.writeFileSync(
      path.join(dir, 'flownote-plugin.json'),
      JSON.stringify({ id: 'com.example.demo', name: 'Demo', version: '1.0.0', permissions: [], ...overrides }),
    )
  }

  it('zips the manifest + dist/*.js + src/*.html into a real, unzip-able .fnp', () => {
    writeManifest(tmpDir)
    fs.mkdirSync(path.join(tmpDir, 'dist'))
    fs.writeFileSync(path.join(tmpDir, 'dist', 'index.js'), 'export {}')
    fs.mkdirSync(path.join(tmpDir, 'src'))
    fs.writeFileSync(path.join(tmpDir, 'src', 'block.html'), '<html></html>')

    const outPath = packPlugin({ cwd: tmpDir })
    expect(outPath).toBe(path.join(tmpDir, 'demo-1.0.0.fnp'))
    expect(fs.existsSync(outPath)).toBe(true)

    const list = spawnSync('unzip', ['-l', outPath], { encoding: 'utf-8' })
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('flownote-plugin.json')
    expect(list.stdout).toContain('index.js')
    expect(list.stdout).toContain('block.html')
  })

  it('rejects a manifest missing required fields', () => {
    fs.writeFileSync(path.join(tmpDir, 'flownote-plugin.json'), JSON.stringify({ id: 'com.example.demo' }))
    expect(() => packPlugin({ cwd: tmpDir })).toThrow(/must have id, name, and version/)
  })

  it('rejects an unknown permission', () => {
    writeManifest(tmpDir, { permissions: ['storage:read', 'nonsense:permission'] })
    expect(() => packPlugin({ cwd: tmpDir })).toThrow(/unknown permission "nonsense:permission"/)
  })

  it('refuses to pack with nothing built', () => {
    writeManifest(tmpDir)
    expect(() => packPlugin({ cwd: tmpDir })).toThrow(/run "flownote build" first/)
  })

  it('honours an explicit --out path', () => {
    writeManifest(tmpDir)
    fs.mkdirSync(path.join(tmpDir, 'dist'))
    fs.writeFileSync(path.join(tmpDir, 'dist', 'index.js'), 'export {}')
    const outPath = path.join(tmpDir, 'custom-name.fnp')
    expect(packPlugin({ cwd: tmpDir, out: outPath })).toBe(outPath)
    expect(fs.existsSync(outPath)).toBe(true)
  })
})

describe('buildPlugin', () => {
  it('runs the local node_modules/.bin/tsc when present', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true })
    const fakeTsc = path.join(tmpDir, 'node_modules', '.bin', 'tsc')
    fs.writeFileSync(fakeTsc, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(fakeTsc, 0o755)
    expect(buildPlugin({ cwd: tmpDir })).toBe(0)
  })

  it('propagates a non-zero tsc exit code', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true })
    const fakeTsc = path.join(tmpDir, 'node_modules', '.bin', 'tsc')
    fs.writeFileSync(fakeTsc, '#!/bin/sh\nexit 2\n')
    fs.chmodSync(fakeTsc, 0o755)
    expect(buildPlugin({ cwd: tmpDir })).toBe(2)
  })
})

describe('devPlugin', () => {
  it('copies the manifest + built assets into installInto/plugins/<id> once tsc reports "Found 0 errors."', async () => {
    fs.writeFileSync(path.join(tmpDir, 'flownote-plugin.json'), JSON.stringify({ id: 'com.example.demo', name: 'Demo', version: '1.0.0', permissions: [] }))
    fs.mkdirSync(path.join(tmpDir, 'dist'))
    fs.writeFileSync(path.join(tmpDir, 'dist', 'index.js'), 'export {}')

    const installInto = fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-cli-install-'))
    try {
      const fakeChild = new EventEmitter() as unknown as ReturnType<typeof import('node:child_process').spawn>
      // @ts-expect-error -- test double: only `.stdout` is exercised by devPlugin
      fakeChild.stdout = new EventEmitter()
      const spawnFn = vi.fn().mockReturnValue(fakeChild)

      devPlugin({ cwd: tmpDir, installInto, spawnFn: spawnFn as never })
      // @ts-expect-error -- same test double
      fakeChild.stdout.emit('data', Buffer.from('Found 0 errors. Watching for file changes.\n'))

      const installedManifest = path.join(installInto, 'plugins', 'com.example.demo', 'flownote-plugin.json')
      await vi.waitFor(() => expect(fs.existsSync(installedManifest)).toBe(true))
      expect(fs.existsSync(path.join(installInto, 'plugins', 'com.example.demo', 'index.js'))).toBe(true)
    } finally {
      fs.rmSync(installInto, { recursive: true, force: true })
    }
  })

  it('does nothing when installInto is not given', () => {
    fs.writeFileSync(path.join(tmpDir, 'flownote-plugin.json'), JSON.stringify({ id: 'com.example.demo', name: 'Demo', version: '1.0.0', permissions: [] }))
    const fakeChild = new EventEmitter() as unknown as ReturnType<typeof import('node:child_process').spawn>
    // @ts-expect-error -- test double
    fakeChild.stdout = new EventEmitter()
    const spawnFn = vi.fn().mockReturnValue(fakeChild)

    expect(() => {
      devPlugin({ cwd: tmpDir, spawnFn: spawnFn as never })
      // @ts-expect-error -- same test double
      fakeChild.stdout.emit('data', Buffer.from('Found 0 errors. Watching for file changes.\n'))
    }).not.toThrow()
  })
})
