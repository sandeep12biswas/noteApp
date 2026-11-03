import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from './cli'

let tmpDir: string
let logs: string[]
let errors: string[]
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-cli-main-'))
  logs = []
  errors = []
  logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    logs.push(msg)
  })
  errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: string) => {
    errors.push(msg)
  })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('main', () => {
  it('prints help and exits non-zero with no command', () => {
    expect(main([])).toBe(1)
    expect(logs.join('\n')).toContain('flownote create')
  })

  it('prints help and exits 0 for --help', () => {
    expect(main(['--help'])).toBe(0)
    expect(logs.join('\n')).toContain('flownote pack')
  })

  it('rejects an unknown command', () => {
    expect(main(['frobnicate'])).toBe(1)
    expect(errors.join('\n')).toContain('unknown command "frobnicate"')
  })

  it('create scaffolds a plugin at --dir', () => {
    expect(main(['create', 'my-plugin', '--dir', tmpDir])).toBe(0)
    expect(fs.existsSync(path.join(tmpDir, 'my-plugin', 'flownote-plugin.json'))).toBe(true)
    expect(logs.join('\n')).toContain('Created')
  })

  it('create requires a name', () => {
    expect(main(['create'])).toBe(1)
    expect(errors.join('\n')).toContain('usage: flownote create')
  })

  it('create rejects an invalid name without touching the filesystem', () => {
    expect(main(['create', 'Bad Name', '--dir', tmpDir])).toBe(1)
    expect(errors.join('\n')).toContain('invalid plugin name')
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })

  it('pack surfaces a validation error as a clean message, not a stack trace', () => {
    expect(main(['pack', '--cwd', tmpDir])).toBe(1)
    expect(errors.join('\n')).toContain('no flownote-plugin.json')
  })
})
