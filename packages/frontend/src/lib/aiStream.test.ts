import { afterEach, describe, expect, it } from 'vitest'
import { AI_NO_BACKEND, runAiStream } from './aiStream'
import { setIPCAdapter } from '../store/notebookStore'

afterEach(() => setIPCAdapter(null))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const backend = (aiComplete: (...args: any[]) => AsyncIterableIterator<string>) => setIPCAdapter({ aiComplete } as any)

describe('runAiStream', () => {
  it('passes each chunk on and resolves done', async () => {
    const calls: unknown[][] = []
    backend(async function* (...args) {
      calls.push(args)
      yield 'a'
      yield 'b'
    })
    const got: string[] = []
    const result = await runAiStream({ prompt: 'p', context: '', providerId: 'x', onText: (t) => got.push(t) }).done
    expect(result).toEqual({ status: 'done' })
    expect(got).toEqual(['a', 'b'])
    expect(calls[0]).toEqual(['p', '', 'x'])
  })

  it('stop cancels the request and resolves "stopped"', async () => {
    let returned = false
    let release!: () => void
    backend(() => {
      let sent = false
      const it = {
        next: () =>
          sent
            ? new Promise<IteratorResult<string>>((r) => (release = () => r({ value: undefined, done: true })))
            : ((sent = true), Promise.resolve({ value: 'first', done: false } as IteratorResult<string>)),
        return: () => {
          returned = true
          release?.()
          return Promise.resolve({ value: undefined, done: true } as IteratorResult<string>)
        },
        [Symbol.asyncIterator]: () => it,
      }
      return it
    })
    const got: string[] = []
    const handle = runAiStream({ prompt: 'p', context: '', onText: (t) => got.push(t) })
    await new Promise((r) => setTimeout(r, 0))
    handle.stop()
    expect(await handle.done).toEqual({ status: 'stopped' })
    expect(returned).toBe(true)
    expect(got).toEqual(['first'])
  })

  it('turns a backend error into a readable message, never a rejection', async () => {
    // eslint-disable-next-line require-yield -- fails before yielding
    backend(async function* () {
      throw new Error('The provider rejected the API key (401)')
    })
    expect(await runAiStream({ prompt: 'p', context: '', onText: () => {} }).done).toEqual({
      status: 'error',
      message: 'The provider rejected the API key (401)',
    })
  })

  it('without a backend says AI is unavailable', async () => {
    expect(await runAiStream({ prompt: 'p', context: '', onText: () => {} }).done).toEqual({ status: 'error', message: AI_NO_BACKEND })
  })
})
