// Validated against the real `unzip` binary rather than a hand-written
// reader — the whole point of this file's zip writer is producing a
// standard-conformant archive, so a real, independent implementation
// reading it back is a stronger check than one written to agree with
// itself.
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createZip, crc32 } from './zip'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flownote-cli-zip-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('crc32', () => {
  it('matches the well-known CRC-32 of "123456789"', () => {
    // The standard CRC-32 check value, quoted by every implementation's own test suite.
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('is 0 for an empty buffer', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })
})

describe('createZip', () => {
  it('produces an archive a real unzip can list and extract byte-for-byte', () => {
    const entries = [
      { name: 'flownote-plugin.json', data: Buffer.from('{"id":"com.example.demo"}') },
      { name: 'index.js', data: Buffer.from('export const x = 1;\n') },
      { name: 'block.html', data: Buffer.from('<!doctype html><body>hi</body>') },
    ]
    const zipPath = path.join(tmpDir, 'demo.fnp')
    fs.writeFileSync(zipPath, createZip(entries))

    const list = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf-8' })
    expect(list.status).toBe(0)
    for (const entry of entries) expect(list.stdout).toContain(entry.name)

    const extractDir = path.join(tmpDir, 'out')
    const extract = spawnSync('unzip', ['-o', zipPath, '-d', extractDir], { encoding: 'utf-8' })
    expect(extract.status).toBe(0)
    for (const entry of entries) {
      expect(fs.readFileSync(path.join(extractDir, entry.name))).toEqual(entry.data)
    }
  })
})
