// Sync settings (sync step S7) — choose where to sync, sign in, set the
// passphrase, then see how it's going. Same dialog shell as
// AiSettingsDialog.tsx. Everything it shows comes from syncStore's status
// (pushed by the backend), so it follows a sync in progress without polling.
import type { SyncCloudTarget, SyncStatus, SyncTarget } from '@flownote/ipc-adapter'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { relativeTime } from '../lib/relativeTime'
import { useSyncStore } from '../store/syncStore'
import { massDeleteText } from './MassDeleteBanner'

export const TARGET_LABELS: Record<Exclude<SyncTarget, 'none'>, string> = {
  onedrive: 'OneDrive',
  gdrive: 'Google Drive',
  folder: 'A folder on this computer',
}

const TARGET_HINTS: Record<Exclude<SyncTarget, 'none'>, string> = {
  onedrive: 'Kept in Apps/FlowNote in your OneDrive.',
  gdrive: 'Kept in a FlowNote folder in your Google Drive.',
  folder: 'For a folder Dropbox, Syncthing or a network drive keeps in step.',
}

const MIN_PASSPHRASE = 8

/** Where the notes go, for sentences: "OneDrive (me@x.com)", "/home/me/Sync". */
export function placeOf(status: SyncStatus): string {
  if (status.target === 'folder') return status.folderPath ?? 'the sync folder'
  if (status.target === 'none') return 'nowhere'
  const name = TARGET_LABELS[status.target]
  return status.accountLabel ? `${name} (${status.accountLabel})` : name
}

const button =
  'rounded-control bg-lavender-600 px-3 py-1 text-xs font-medium text-white hover:bg-lavender-700 disabled:cursor-not-allowed disabled:opacity-50'
const plainButton = 'rounded-control border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'
const input = 'w-full rounded-control border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800'
const link = 'text-xs text-lavender-600 hover:underline dark:text-lavender-400'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  )
}

export function SyncSettingsDialog({ onClose }: { onClose: () => void }) {
  const status = useSyncStore((s) => s.status)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // "Change…" reopens the target choice without disconnecting first.
  const [choosing, setChoosing] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Runs a settings action, showing its error (if any) in the dialog. */
  const act = async (action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
    setError(null)
    setBusy(true)
    try {
      const result = await action()
      if (!result.ok) setError(result.error ?? 'Something went wrong.')
      return result.ok
    } finally {
      setBusy(false)
    }
  }

  let body: ReactNode
  if (!status) {
    body = <p className="text-xs text-gray-500">Sync isn't available here (no FlowNote backend is running).</p>
  } else if (status.state === 'off' || choosing) {
    body = <ChooseTarget status={status} busy={busy} act={act} onChosen={() => setChoosing(false)} onCancel={choosing ? () => setChoosing(false) : undefined} />
  } else if (status.state === 'needsSignIn') {
    body = <SignIn status={status} busy={busy} act={act} />
  } else if (status.state === 'needsPassphrase') {
    body = <Passphrase status={status} busy={busy} act={act} />
  } else {
    body = <Connected status={status} busy={busy} act={act} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="Sync settings"
        aria-modal="true"
        className="flex max-h-[80vh] w-[480px] flex-col gap-4 overflow-y-auto rounded-dialog border border-gray-200 bg-white p-4 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Sync</h2>
          <button type="button" aria-label="Close sync settings" onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            ✕
          </button>
        </div>

        {body}

        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {status && <DeviceName status={status} act={act} />}

        {status && status.state !== 'off' && !choosing && (
          <p className="text-xs text-gray-500">
            {status.connected ? 'Syncing to' : 'Sync location:'} {placeOf(status)}.{' '}
            <button type="button" className={link} onClick={() => setChoosing(true)}>
              Change…
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

type Act = (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>

function ChooseTarget({ status, busy, act, onChosen, onCancel }: { status: SyncStatus; busy: boolean; act: Act; onChosen: () => void; onCancel?: () => void }) {
  const configure = useSyncStore((s) => s.configure)
  const signIn = useSyncStore((s) => s.signIn)
  const pickFolder = useSyncStore((s) => s.pickFolder)
  const [target, setTarget] = useState<Exclude<SyncTarget, 'none'>>(status.target === 'none' ? 'onedrive' : status.target)
  const [folderPath, setFolderPath] = useState(status.folderPath ?? '')
  const [canBrowse, setCanBrowse] = useState(true)

  const browse = async () => {
    const picked = await pickFolder()
    if (picked === undefined) setCanBrowse(false) // no folder dialog here: type it
    else if (picked) setFolderPath(picked)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await act(() => configure(target === 'folder' ? { target, folderPath: folderPath.trim() } : { target }))
    if (!ok) return
    onChosen()
    // A cloud drive needs a sign-in next; start it straight away.
    if (target !== 'folder') void act(() => signIn(target))
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Section title="Where to sync">
        <p className="text-xs text-gray-500">Your notes are encrypted on this device before they leave it; only your devices can read them.</p>
        <div role="radiogroup" aria-label="Where to sync" className="flex flex-col gap-1">
          {(Object.keys(TARGET_LABELS) as Array<Exclude<SyncTarget, 'none'>>).map((t) => (
            <label key={t} className="flex cursor-pointer items-start gap-2 rounded-menu border border-gray-200 px-2 py-1.5 dark:border-gray-700">
              <input type="radio" name="sync-target" value={t} checked={target === t} onChange={() => setTarget(t)} className="mt-0.5" />
              <span>
                <span className="block text-xs font-medium">{TARGET_LABELS[t]}</span>
                <span className="block text-[11px] text-gray-500">{TARGET_HINTS[t]}</span>
              </span>
            </label>
          ))}
        </div>
        {target === 'folder' && (
          <div className="flex gap-2">
            <input
              aria-label="Sync folder path"
              className={input}
              placeholder="/home/you/Dropbox/FlowNote"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
            />
            {canBrowse && (
              <button type="button" className={plainButton} onClick={() => void browse()}>
                Browse…
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button type="submit" className={button} disabled={busy || (target === 'folder' && !folderPath.trim())}>
            {target === 'folder' ? 'Continue' : `Continue to ${TARGET_LABELS[target]} sign-in`}
          </button>
          {onCancel && (
            <button type="button" className={plainButton} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </Section>
    </form>
  )
}

function SignIn({ status, busy, act }: { status: SyncStatus; busy: boolean; act: Act }) {
  const signIn = useSyncStore((s) => s.signIn)
  const cancelSignIn = useSyncStore((s) => s.cancelSignIn)
  const signInUrl = useSyncStore((s) => s.signInUrl)
  const [copied, setCopied] = useState(false)
  const name = status.target === 'none' || status.target === 'folder' ? 'the cloud drive' : TARGET_LABELS[status.target]

  if (status.signingIn) {
    return (
      <Section title="Sign in">
        <p className="text-xs">Finish signing in to {name} in your browser…</p>
        {signInUrl && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Browser didn't open? Copy this link into it:</span>
            <div className="flex gap-2">
              <input aria-label="Sign-in link" readOnly className={input} value={signInUrl} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className={plainButton}
                onClick={() => {
                  void navigator.clipboard?.writeText(signInUrl).then(() => setCopied(true))
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <div>
          <button type="button" className={plainButton} onClick={() => void act(() => cancelSignIn())}>
            Cancel sign-in
          </button>
        </div>
      </Section>
    )
  }
  return (
    <Section title="Sign in">
      <p className="text-xs">
        {status.accountLabel ? `The ${name} sign-in for ${status.accountLabel} has expired or was revoked.` : `Sign in to ${name} to sync your notes there.`}
      </p>
      {status.lastError && <p className="text-[11px] text-gray-500">{status.lastError}</p>}
      <div>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => {
            if (status.target === 'onedrive' || status.target === 'gdrive') void act(() => signIn(status.target as SyncCloudTarget))
          }}
        >
          Sign in to {name}
        </button>
      </div>
    </Section>
  )
}

function Passphrase({ status, busy, act }: { status: SyncStatus; busy: boolean; act: Act }) {
  const connect = useSyncStore((s) => s.connect)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState<string | null>(null)
  const joining = status.vaultExists === true

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMismatch(null)
    if (!joining) {
      if (passphrase.length < MIN_PASSPHRASE) return setMismatch(`Use at least ${MIN_PASSPHRASE} characters.`)
      if (passphrase !== confirm) return setMismatch("The two passphrases don't match.")
    }
    await act(() => connect(passphrase))
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Section title="Passphrase">
        <p className="text-xs">
          {joining
            ? `${placeOf(status)} already holds FlowNote notes. Enter the passphrase you chose on your other device.`
            : 'Choose a passphrase. Your other devices will need it too.'}
        </p>
        {status.vaultExists === null && (
          <p className="text-[11px] text-gray-500">Already set up sync on another device? Enter that passphrase.</p>
        )}
        <input type="password" aria-label="Passphrase" className={input} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoFocus />
        {!joining && (
          <input type="password" aria-label="Confirm passphrase" className={input} placeholder="Again, to be sure" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        )}
        <p className="rounded-control bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          There's no way to recover a lost passphrase: the synced copy can't be read without it. The notes on this device are kept either way.
        </p>
        {mismatch && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {mismatch}
          </p>
        )}
        <div>
          <button type="submit" className={button} disabled={busy || !passphrase}>
            {busy ? 'Connecting…' : 'Start syncing'}
          </button>
        </div>
      </Section>
    </form>
  )
}

const STATE_TEXT: Partial<Record<SyncStatus['state'], string>> = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  error: "Couldn't sync",
  heldBack: 'Waiting for you to confirm deletions',
}

function Connected({ status, busy, act }: { status: SyncStatus; busy: boolean; act: Act }) {
  const syncNow = useSyncStore((s) => s.syncNow)
  const disconnect = useSyncStore((s) => s.disconnect)
  const confirmMassDelete = useSyncStore((s) => s.confirmMassDelete)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  return (
    <Section title="Status">
      <p className="text-xs" role="status">
        <span className="font-medium">{STATE_TEXT[status.state] ?? status.state}</span>
        {status.lastSyncAt !== null && <span className="text-gray-500"> · last synced {relativeTime(status.lastSyncAt)}</span>}
      </p>
      {status.state === 'error' && status.lastError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {status.lastError}
        </p>
      )}
      {status.heldBack && (
        <div className="flex flex-col gap-1.5 rounded-menu border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs dark:border-amber-700 dark:bg-amber-900/30">
          <span>{massDeleteText(status.heldBack)}</span>
          <div>
            <button type="button" className={button} disabled={busy} onClick={() => void act(() => confirmMassDelete())}>
              Apply deletions
            </button>
          </div>
        </div>
      )}
      {(status.quarantined > 0 || status.waiting > 0) && (
        <p className="text-[11px] text-gray-500">
          {status.quarantined > 0 && `${status.quarantined} synced file${status.quarantined === 1 ? '' : 's'} couldn't be read and ${status.quarantined === 1 ? 'is' : 'are'} set aside. `}
          {status.waiting > 0 && `${status.waiting} change${status.waiting === 1 ? '' : 's'} from other devices ${status.waiting === 1 ? 'is' : 'are'} still on the way.`}
        </p>
      )}
      {status.peers.length > 0 && (
        <div className="text-xs">
          <span className="text-gray-500">Other devices: </span>
          {status.peers.map((p) => `${p.name ?? 'Unnamed device'}${p.lastSeenAt !== null ? ` (${relativeTime(p.lastSeenAt)})` : ''}`).join(', ')}
        </div>
      )}
      {confirmingDisconnect ? (
        <div className="flex flex-col gap-1.5 text-xs">
          <span>Stop syncing on this device? Your notes stay here and in {placeOf(status)}.</span>
          <div className="flex gap-2">
            <button type="button" className={button} onClick={() => void act(() => disconnect()).then(() => setConfirmingDisconnect(false))}>
              Stop syncing
            </button>
            <button type="button" className={plainButton} onClick={() => setConfirmingDisconnect(false)}>
              Keep syncing
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={button} disabled={busy || status.state === 'syncing'} onClick={() => void act(() => syncNow())}>
            Sync now
          </button>
          <button type="button" className={plainButton} onClick={() => setConfirmingDisconnect(true)}>
            Disconnect…
          </button>
        </div>
      )}
    </Section>
  )
}

function DeviceName({ status, act }: { status: SyncStatus; act: Act }) {
  const configure = useSyncStore((s) => s.configure)
  const [name, setName] = useState(status.deviceName)
  useEffect(() => setName(status.deviceName), [status.deviceName])

  const save = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== status.deviceName) void act(() => configure({ deviceName: trimmed }))
    else setName(status.deviceName)
  }

  return (
    <label className="flex items-center gap-2 text-xs text-gray-500">
      <span className="shrink-0">This device's name</span>
      <input
        aria-label="This device's name"
        className={input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}
