import { describe, expect, it, vi } from 'vitest'
import { pushIterator, type PushSink } from './pushIterator'

function controlled<T>() {
  let sink!: PushSink<T>
  const stop = vi.fn()
  const it = pushIterator<T>((s) => {
    sink = s
    return stop
  })
  return { it, sink: () => sink, stop }
}

describe('pushIterator', () => {
  it('yields values pushed before and after the consumer asks, then ends', async () => {
    const { it, sink } = controlled<string>()
    sink().push('a')
    const out: string[] = []
    const consume = (async () => {
      for await (const v of it) out.push(v)
    })()
    sink().push('b')
    sink().end()
    await consume
    expect(out).toEqual(['a', 'b'])
  })

  it('throws the error after already-buffered values', async () => {
    const { it, sink } = controlled<string>()
    sink().push('partial')
    sink().fail(new Error('Overloaded'))
    const out: string[] = []
    await expect(
      (async () => {
        for await (const v of it) out.push(v)
      })(),
    ).rejects.toThrow('Overloaded')
    expect(out).toEqual(['partial'])
  })

  it('a failure while starting rejects the first next() instead of throwing', async () => {
    const it = pushIterator<string>(() => {
      throw new Error('no IPC transport')
    })
    await expect(it.next()).rejects.toThrow('no IPC transport')
  })

  it('stopping early (break) calls the stop callback once; finishing normally does not', async () => {
    const early = controlled<number>()
    early.sink().push(1)
    early.sink().push(2)
    for await (const v of early.it) {
      if (v === 1) break
    }
    expect(early.stop).toHaveBeenCalledTimes(1)

    const normal = controlled<number>()
    normal.sink().end()
    const drained: number[] = []
    for await (const v of normal.it) drained.push(v)
    expect(drained).toEqual([])
    expect(normal.stop).not.toHaveBeenCalled()
  })
})
