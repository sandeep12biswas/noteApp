import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { SidecarClient, SidecarClosedError } from './sidecar'

/**
 * A fake sidecar process: `stdin` is a PassThrough the test can read from
 * to see what the client sent, `stdout` is a PassThrough the test writes
 * fake responses into to simulate the Rust binary replying.
 */
function fakeIO() {
  return { stdin: new PassThrough(), stdout: new PassThrough() }
}

function nextWrittenRequest(stdin: PassThrough): Promise<{ id: number; method: string; params: unknown }> {
  return new Promise((resolve) => {
    stdin.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString())))
  })
}

describe('SidecarClient', () => {
  it('resolves a request when a matching response line arrives', async () => {
    const io = fakeIO()
    const client = new SidecarClient(io)

    const sent = nextWrittenRequest(io.stdin)
    const result = client.request('ping')
    const { id, method } = await sent
    expect(method).toBe('ping')

    io.stdout.write(JSON.stringify({ id, result: 'pong' }) + '\n')

    await expect(result).resolves.toBe('pong')
  })

  it('rejects when the response carries an error', async () => {
    const io = fakeIO()
    const client = new SidecarClient(io)

    const sent = nextWrittenRequest(io.stdin)
    const result = client.request('get_page', { pageId: 'missing' })
    const { id } = await sent

    io.stdout.write(JSON.stringify({ id, error: 'no such page: missing' }) + '\n')

    await expect(result).rejects.toThrow('no such page: missing')
  })

  it('correlates concurrent requests by id independently', async () => {
    const io = fakeIO()
    const client = new SidecarClient(io)

    const requests: Array<{ id: number; method: string }> = []
    io.stdin.on('data', (chunk: Buffer) => requests.push(JSON.parse(chunk.toString())))

    const first = client.request('ping')
    const second = client.request('get_page', { pageId: 'p1' })
    // Let both writes flush before responding out of order.
    await new Promise((resolve) => setImmediate(resolve))

    const [firstReq, secondReq] = requests
    io.stdout.write(JSON.stringify({ id: secondReq!.id, result: { id: 'p1' } }) + '\n')
    io.stdout.write(JSON.stringify({ id: firstReq!.id, result: 'pong' }) + '\n')

    await expect(second).resolves.toEqual({ id: 'p1' })
    await expect(first).resolves.toBe('pong')
  })

  it('ignores unparseable lines instead of throwing', async () => {
    const io = fakeIO()
    const client = new SidecarClient(io)

    const sent = nextWrittenRequest(io.stdin)
    const result = client.request('ping')
    const { id } = await sent

    io.stdout.write('not json\n')
    io.stdout.write(JSON.stringify({ id, result: 'pong' }) + '\n')

    await expect(result).resolves.toBe('pong')
  })

  it('rejects every pending request on close()', async () => {
    const io = fakeIO()
    const client = new SidecarClient(io)

    const result = client.request('ping')
    client.close()

    await expect(result).rejects.toBeInstanceOf(SidecarClosedError)
  })

  it('rejects new requests immediately once closed', async () => {
    const io = fakeIO()
    const client = new SidecarClient(io)
    client.close()

    await expect(client.request('ping')).rejects.toBeInstanceOf(SidecarClosedError)
  })
})

describe('SidecarClient.requestStream', () => {
  it('passes {id, chunk} lines to onChunk and settles on the final response, while other requests still complete', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const client = new SidecarClient({ stdin, stdout })
    const chunks: string[] = []
    const stream = client.requestStream('ai_complete', { prompt: 'p' }, (c) => chunks.push(c))
    const ping = client.request('ping')

    stdout.write(JSON.stringify({ id: stream.id, chunk: 'Hel' }) + '\n')
    stdout.write(JSON.stringify({ id: stream.id + 1, result: 'pong' }) + '\n') // the ping, answered mid-stream
    stdout.write(JSON.stringify({ id: stream.id, chunk: 'lo' }) + '\n')
    stdout.write(JSON.stringify({ id: stream.id, result: null }) + '\n')

    await expect(ping).resolves.toBe('pong')
    await expect(stream.done).resolves.toBeNull()
    expect(chunks).toEqual(['Hel', 'lo'])
  })

  it('rejects done with the final error after any chunks', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const client = new SidecarClient({ stdin, stdout })
    const chunks: string[] = []
    const stream = client.requestStream('ai_complete', {}, (c) => chunks.push(c))
    stdout.write(JSON.stringify({ id: stream.id, chunk: 'par' }) + '\n')
    stdout.write(JSON.stringify({ id: stream.id, error: 'Overloaded' }) + '\n')
    await expect(stream.done).rejects.toThrow('Overloaded')
    expect(chunks).toEqual(['par'])
  })
})
