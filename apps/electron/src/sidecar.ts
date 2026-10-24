// Sidecar client — talks to the flownote-electron Rust binary over the
// newline-delimited JSON protocol defined in
// crates/flownote-electron/src/protocol.rs. DESIGN.md §3.2/§8.1.
//
// SidecarClient wraps one running process's stdio. It is deliberately
// decoupled from `child_process` (it only needs something with a writable
// `stdin` and a readable `stdout`), so tests can drive it with plain Node
// streams instead of spawning the real Rust binary — see sidecar.test.ts.
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export interface SidecarIO {
  stdin: Writable
  stdout: Readable
}

interface WireResponse {
  id: number
  result?: unknown
  error?: string
  /** Set on intermediate lines of a streaming request (`ai_complete`); the final line has `result`/`error` as usual. */
  chunk?: string
}

/** A streaming request in flight: its id (for `ai_cancel`) and the final result. */
export interface SidecarStream {
  id: number
  done: Promise<unknown>
}

/** Thrown for every request still pending when the sidecar goes away. */
export class SidecarClosedError extends Error {
  constructor() {
    super('sidecar process closed before responding')
    this.name = 'SidecarClosedError'
  }
}

export class SidecarClient {
  #io: SidecarIO
  #nextId = 1
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onChunk?: (chunk: string) => void }>()
  #closed = false

  constructor(io: SidecarIO) {
    this.#io = io
    const rl = createInterface({ input: io.stdout })
    rl.on('line', (line) => this.#handleLine(line))
  }

  /** Sends one request and resolves/rejects when the matching response arrives. */
  request(method: string, params: unknown = null): Promise<unknown> {
    return this.requestStream(method, params, () => {}).done
  }

  /**
   * Like `request`, for methods that stream (`ai_complete`): each
   * intermediate `{id, chunk}` line goes to `onChunk`, and `done` settles on
   * the final response. Other requests keep flowing meanwhile.
   */
  requestStream(method: string, params: unknown, onChunk: (chunk: string) => void): SidecarStream {
    const id = this.#nextId++
    if (this.#closed) return { id, done: Promise.reject(new SidecarClosedError()) }
    const done = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onChunk })
      this.#io.stdin.write(JSON.stringify({ id, method, params }) + '\n', (err) => {
        if (err) {
          this.#pending.delete(id)
          reject(err)
        }
      })
    })
    return { id, done }
  }

  /** Rejects every in-flight request. Call once the underlying process has exited. */
  close(): void {
    this.#closed = true
    for (const { reject } of this.#pending.values()) reject(new SidecarClosedError())
    this.#pending.clear()
  }

  #handleLine(line: string): void {
    if (!line.trim()) return

    let response: WireResponse
    try {
      response = JSON.parse(line)
    } catch {
      // A malformed line from the sidecar is a protocol bug, not a reason
      // to crash the whole Electron main process — drop it and move on.
      return
    }

    const pending = this.#pending.get(response.id)
    if (!pending) return
    if (response.chunk !== undefined) {
      pending.onChunk?.(response.chunk)
      return
    }
    this.#pending.delete(response.id)

    if (response.error !== undefined) {
      pending.reject(new Error(response.error))
    } else {
      pending.resolve(response.result)
    }
  }
}
