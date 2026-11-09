// Sync step S7: the status bar's sync indicator. Hidden until sync is set
// up; clicking it opens the Sync settings dialog.
import type { SyncStatus } from '@flownote/ipc-adapter'
import { relativeTime } from '../lib/relativeTime'
import { useSyncStore } from '../store/syncStore'
import { useUIStore } from '../store/uiStore'

function describe(status: SyncStatus): { icon: string; text: string } {
  switch (status.state) {
    case 'idle':
      return { icon: '✓', text: 'Synced' }
    case 'syncing':
      return { icon: '↻', text: 'Syncing…' }
    case 'error':
      return { icon: '⚠', text: 'Sync error' }
    default:
      return { icon: '●', text: 'Sync needs attention' }
  }
}

export function SyncStatusIndicator() {
  const status = useSyncStore((s) => s.status)
  const open = useUIStore((s) => s.setSyncSettingsOpen)
  if (!status || status.state === 'off') return null
  const { icon, text } = describe(status)
  const detail =
    status.state === 'error' && status.lastError
      ? status.lastError
      : status.lastSyncAt !== null
        ? `Last synced ${relativeTime(status.lastSyncAt)}`
        : 'Not synced yet'
  return (
    <button
      type="button"
      data-testid="sync-indicator"
      data-state={status.state}
      aria-label={`${text}. ${detail}. Open sync settings`}
      title={detail}
      onClick={() => open(true)}
      className={
        'flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 ' +
        (status.state === 'error' ? 'text-red-500' : status.state === 'idle' || status.state === 'syncing' ? '' : 'text-amber-600 dark:text-amber-400')
      }
    >
      <span aria-hidden="true" className={status.state === 'syncing' ? 'inline-block animate-spin' : ''}>
        {icon}
      </span>
      {text}
    </button>
  )
}
