// Remembers the last page the user had open so the app can reopen it on
// the next launch, instead of always starting on an empty "select or create
// a page" canvas. `localStorage` (not a notebookStore field) since it must
// survive an app restart on its own, independent of `hydrateFromIPC`'s
// round-trip — and it's a pure per-device UI convenience, not data worth a
// backend column/migration. Wrapped in try/catch the same way
// `themeStore.ts`'s localStorage reads/writes are: a private window,
// cleared site data, or a locked-down preload can make `localStorage`
// throw, and losing this convenience must never break the app.
const KEY = 'flownote:lastOpenedPage'

interface LastOpenedPage {
  folderId: string
  fileId: string
}

export function saveLastOpenedPage(folderId: string, fileId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ folderId, fileId } satisfies LastOpenedPage))
  } catch {
    // best-effort — see module doc
  }
}

export function loadLastOpenedPage(): LastOpenedPage | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as LastOpenedPage).folderId === 'string' &&
      typeof (parsed as LastOpenedPage).fileId === 'string'
    ) {
      return parsed as LastOpenedPage
    }
    return null
  } catch {
    return null
  }
}
