// One AI request, streamed — shared by the ribbon's AI box (RibbonRoot.tsx
// `AIInsertPanel`) and the "/ Ask AI" draft (canvas/SegmentHost.tsx), so
// both handle stopping and errors the same way. The request runs in the
// backend (`IPCAdapter.aiComplete`), so API keys never reach the page;
// returning the iterator cancels it there.
import { getIPCAdapter } from '../store/notebookStore'

export const AI_NO_BACKEND = 'AI unavailable — no backend connected.'
export const AI_NO_PROVIDER = 'No AI provider set up yet — open AI settings (⚙).'

export type AiStreamResult = { status: 'done' } | { status: 'stopped' } | { status: 'error'; message: string }

export interface AiStreamHandle {
  /** Ends the request early; `done` then resolves `{ status: 'stopped' }`. */
  stop: () => void
  /** Resolves when the stream ends — never rejects. */
  done: Promise<AiStreamResult>
}

export function runAiStream(options: {
  prompt: string
  /** Note text sent along with the prompt; '' sends the prompt alone. */
  context: string
  providerId?: string
  onText: (text: string) => void
}): AiStreamHandle {
  const ipc = getIPCAdapter()
  let stopped = false
  let stream: AsyncIterableIterator<string> | null = null

  const done = (async (): Promise<AiStreamResult> => {
    if (!ipc) return { status: 'error', message: AI_NO_BACKEND }
    try {
      stream = ipc.aiComplete(options.prompt, options.context, options.providerId)
      for await (const text of stream) {
        if (stopped) break
        options.onText(text)
      }
      return stopped ? { status: 'stopped' } : { status: 'done' }
    } catch (err) {
      if (stopped) return { status: 'stopped' }
      // A readable message from the backend — wrong key, unreachable
      // server, provider error — never a crash or an unhandled rejection.
      return { status: 'error', message: err instanceof Error ? err.message : 'AI request failed.' }
    } finally {
      stream = null
    }
  })()

  return {
    stop: () => {
      stopped = true
      void stream?.return?.()
    },
    done,
  }
}
