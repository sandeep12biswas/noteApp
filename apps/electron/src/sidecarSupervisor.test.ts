import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidecarSupervisor, type SupervisedProcess } from './sidecarSupervisor'

/** A fake child process good enough to drive the supervisor in tests. */
class FakeProcess implements SupervisedProcess {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  #exitListener: ((code: number | null) => void) | null = null

  once(event: 'exit', listener: (code: number | null) => void): void {
    if (event === 'exit') this.#exitListener = listener
  }

  kill(): void {
    this.emitExit(null)
  }

  emitExit(code: number | null): void {
    this.#exitListener?.(code)
  }
}

let crashLogPath: string
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'flownote-sidecar-test-'))
  crashLogPath = join(tmpDir, 'crash.log')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('SidecarSupervisor', () => {
  it('forwards request() to the live client', async () => {
    const proc = new FakeProcess()
    const supervisor = new SidecarSupervisor({ spawn: () => proc, crashLogPath })
    supervisor.start()

    proc.stdin.once('data', (chunk: Buffer) => {
      const { id } = JSON.parse(chunk.toString())
      proc.stdout.write(JSON.stringify({ id, result: 'pong' }) + '\n')
    })

    await expect(supervisor.request('ping')).resolves.toBe('pong')
  })

  it('restarts the process on a non-zero exit, with backoff', async () => {
    const processes: FakeProcess[] = []
    const scheduled: Array<{ fn: () => void; delayMs: number }> = []
    const supervisor = new SidecarSupervisor({
      spawn: () => {
        const p = new FakeProcess()
        processes.push(p)
        return p
      },
      crashLogPath,
      scheduleRestart: (fn, delayMs) => scheduled.push({ fn, delayMs }),
    })

    supervisor.start()
    expect(processes).toHaveLength(1)

    processes[0]!.emitExit(1)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.delayMs).toBe(500)

    // Requests made while down reject rather than hanging.
    await expect(supervisor.request('ping')).rejects.toThrow('unavailable')

    scheduled[0]!.fn() // run the scheduled restart
    expect(processes).toHaveLength(2)
  })

  it('does not restart on a clean (code 0) exit', () => {
    const scheduled: Array<() => void> = []
    let spawnCount = 0
    let lastSpawned: FakeProcess | null = null
    const supervisor = new SidecarSupervisor({
      spawn: () => {
        spawnCount++
        lastSpawned = new FakeProcess()
        return lastSpawned
      },
      crashLogPath,
      scheduleRestart: (fn) => scheduled.push(fn),
    })

    supervisor.start()
    lastSpawned!.emitExit(0)

    expect(scheduled).toHaveLength(0)
    expect(spawnCount).toBe(1)
  })

  it('gives up after 3 restarts and calls onGiveUp', () => {
    const scheduled: Array<() => void> = []
    const processes: FakeProcess[] = []
    let gaveUpWithCode: number | null | undefined
    const supervisor = new SidecarSupervisor({
      spawn: () => {
        const p = new FakeProcess()
        processes.push(p)
        return p
      },
      crashLogPath,
      scheduleRestart: (fn) => scheduled.push(fn),
      onGiveUp: (code) => (gaveUpWithCode = code),
    })

    supervisor.start()
    for (let i = 0; i < 3; i++) {
      processes[processes.length - 1]!.emitExit(1)
      const fn = scheduled.pop()
      fn?.()
    }
    // A 4th crash exhausts the 3-attempt budget.
    processes[processes.length - 1]!.emitExit(1)

    expect(gaveUpWithCode).toBe(1)
  })

  it('appends sidecar stderr to the crash log', async () => {
    const proc = new FakeProcess()
    const supervisor = new SidecarSupervisor({ spawn: () => proc, crashLogPath })
    supervisor.start()

    proc.stderr.write('flownote-electron: panicked at src/main.rs\n')
    await new Promise((resolve) => setImmediate(resolve))

    expect(readFileSync(crashLogPath, 'utf8')).toContain('panicked at src/main.rs')
  })
})
