import { describe, expect, it } from 'vitest'
import { resolveIPCAdapter } from './index'

describe('resolveIPCAdapter', () => {
  it('throws when neither Tauri nor Electron IPC is present', async () => {
    await expect(resolveIPCAdapter()).rejects.toThrow('No IPC transport found')
  })
})
