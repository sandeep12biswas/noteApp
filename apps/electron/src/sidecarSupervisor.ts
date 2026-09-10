// Sidecar process supervisor — DESIGN.md §10 "Rust sidecar crash on Linux":
// "Electron main watches the exit code. Non-zero → error dialog + auto-
// restart with exponential backoff (max 3 attempts). Stderr logged to a
// crash file."
//
// Split from sidecar.ts (the request/response client) so the restart policy
// can be unit-tested with a fake `spawn` that exits on command, without
// touching a real child process or the filesystem.
import { appendFileSync } from 'node:fs'
import { SidecarClient, type SidecarIO } from './sidecar'

export interface SupervisedProcess extends SidecarIO {
  stderr: NodeJS.ReadableStream
  once(event: 'exit', listener: (code: number | null) => void): void
  kill(): void
}

const BACKOFF_MS = [500, 1000, 2000]
const MAX_RESTARTS = 3

export interface SidecarSupervisorOptions {
  spawn: () => SupervisedProcess
  /** Absolute path to append crash logs to. */
  crashLogPath: string
  /** Called once restarts are exhausted and the sidecar is considered dead. */
  onGiveUp?: (lastExitCode: number | null) => void
  /** Overridable for tests; defaults to the real `setTimeout`. */
  scheduleRestart?: (fn: () => void, delayMs: number) => void
}

export class SidecarSupervisor {
  #spawn: () => SupervisedProcess
  #crashLogPath: string
  #onGiveUp: (lastExitCode: number | null) => void
  #scheduleRestart: (fn: () => void, delayMs: number) => void

  #client: SidecarClient | null = null
  #restartCount = 0
  #dead = false

  constructor(options: SidecarSupervisorOptions) {
    this.#spawn = options.spawn
    this.#crashLogPath = options.crashLogPath
    this.#onGiveUp = options.onGiveUp ?? (() => {})
    this.#scheduleRestart = options.scheduleRestart ?? ((fn, ms) => void setTimeout(fn, ms))
  }

  start(): void {
    this.#launch()
  }

  /** Proxies to the current client; rejects if the sidecar has given up for good. */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.#dead || !this.#client) {
      return Promise.reject(new Error('flownote sidecar is unavailable'))
    }
    return this.#client.request(method, params)
  }

  stop(): void {
    this.#client?.close()
    this.#client = null
  }

  #launch(): void {
    const proc = this.#spawn()
    this.#client = new SidecarClient(proc)

    proc.stderr.on('data', (chunk: Buffer) => {
      try {
        appendFileSync(this.#crashLogPath, chunk)
      } catch {
        // Logging the crash must never itself crash the supervisor.
      }
    })

    proc.once('exit', (code) => this.#handleExit(code))
  }

  #handleExit(code: number | null): void {
    this.#client?.close()
    this.#client = null

    if (code === 0) return // clean shutdown (app quitting) — nothing to restart

    if (this.#restartCount >= MAX_RESTARTS) {
      this.#dead = true
      this.#onGiveUp(code)
      return
    }

    const delay = BACKOFF_MS[this.#restartCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 2000
    this.#restartCount++
    this.#scheduleRestart(() => this.#launch(), delay)
  }
}
