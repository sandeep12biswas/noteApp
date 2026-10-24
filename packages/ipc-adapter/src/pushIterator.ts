// Turns a push-based stream (an electron-trpc subscription, a Tauri Channel)
// into the AsyncIterableIterator that IPCAdapter.aiComplete returns.
//
//   const it = pushIterator<string>((sink) => {
//     const sub = startStreaming({ onData: sink.push, onEnd: sink.end, onError: sink.fail })
//     return () => sub.stop() // called if the consumer stops early
//   })
//   for await (const text of it) { ... }   // `break` -> the stop callback runs
//
// Values pushed before the consumer asks for them are buffered; an error is
// thrown from the next `next()` after any already-buffered values.

export interface PushSink<T> {
  push: (value: T) => void
  end: () => void
  fail: (error: Error) => void
}

export function pushIterator<T>(start: (sink: PushSink<T>) => () => void): AsyncIterableIterator<T> {
  const buffer: T[] = []
  let done = false
  let error: Error | null = null
  let waiting: { resolve: (r: IteratorResult<T>) => void; reject: (e: Error) => void } | null = null

  const settleWaiting = () => {
    if (!waiting) return
    const w = waiting
    if (buffer.length > 0) {
      waiting = null
      w.resolve({ value: buffer.shift() as T, done: false })
    } else if (error) {
      waiting = null
      w.reject(error)
    } else if (done) {
      waiting = null
      w.resolve({ value: undefined, done: true })
    }
  }

  const sink: PushSink<T> = {
    push: (value) => {
      if (done) return
      buffer.push(value)
      settleWaiting()
    },
    end: () => {
      done = true
      settleWaiting()
    },
    fail: (e) => {
      if (done) return
      error = e
      done = true
      settleWaiting()
    },
  }
  // A failure while starting (no IPC transport, say) surfaces as a rejected
  // first `next()`, like any other stream error — never a synchronous throw
  // out of the method that created the iterator.
  let stop: () => void = () => {}
  try {
    stop = start(sink)
  } catch (e) {
    sink.fail(e instanceof Error ? e : new Error(String(e)))
  }

  const iterator: AsyncIterableIterator<T> = {
    next() {
      if (buffer.length > 0) return Promise.resolve({ value: buffer.shift() as T, done: false })
      if (error) {
        const e = error
        error = null
        return Promise.reject(e)
      }
      if (done) return Promise.resolve({ value: undefined, done: true })
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject }
      })
    },
    return() {
      // The consumer stopped early (`break`, or the Stop button).
      if (!done) {
        done = true
        stop()
      }
      buffer.length = 0
      return Promise.resolve({ value: undefined, done: true })
    },
    [Symbol.asyncIterator]() {
      return iterator
    },
  }
  return iterator
}
