// Sync step S7: when another device's changes would delete a lot at once,
// the backend holds them back (flownote_core::sync, "mass delete") until
// the user says so. This banner asks, above the editor, without blocking
// anything; "Not now" hides it for this session (sync stays held, and the
// status bar keeps saying it needs attention).
import type { SyncStatus } from '@flownote/ipc-adapter'
import { useState } from 'react'
import { useSyncStore } from '../store/syncStore'
import { useUIStore } from '../store/uiStore'

/** "Laptop deleted 6 of 6 pages and 40 of 52 blocks. Apply these deletions here?" */
export function massDeleteText(held: NonNullable<SyncStatus['heldBack']>): string {
  const who = held.deviceName ? `"${held.deviceName}"` : 'Another device'
  const parts: string[] = []
  if (held.pagesDeleted > 0) parts.push(`${held.pagesDeleted} of ${held.pagesTotal} page${held.pagesTotal === 1 ? '' : 's'}`)
  if (held.segmentsDeleted > 0) parts.push(`${held.segmentsDeleted} of ${held.segmentsTotal} block${held.segmentsTotal === 1 ? '' : 's'}`)
  return `${who} deleted ${parts.join(' and ') || 'a lot'}. Apply these deletions here too?`
}

export function MassDeleteBanner() {
  const held = useSyncStore((s) => s.status?.heldBack ?? null)
  const confirmMassDelete = useSyncStore((s) => s.confirmMassDelete)
  const openSettings = useUIStore((s) => s.setSyncSettingsOpen)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!held) return null
  const key = `${held.deviceId}:${held.pagesDeleted}:${held.segmentsDeleted}`
  if (dismissedFor === key) return null

  return (
    <div role="alert" className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
      <span className="flex-1">
        {massDeleteText(held)} {error && <span className="text-red-700 dark:text-red-300">({error})</span>}
      </span>
      <button
        type="button"
        className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700"
        onClick={() => {
          setError(null)
          void confirmMassDelete().then((r) => !r.ok && setError(r.error))
        }}
      >
        Apply
      </button>
      <button type="button" className="hover:underline" onClick={() => setDismissedFor(key)}>
        Not now
      </button>
      <button type="button" className="hover:underline" onClick={() => openSettings(true)}>
        Details
      </button>
    </div>
  )
}
