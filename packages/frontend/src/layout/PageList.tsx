// File panel — DESIGN.md §2.2: files for the selected folder in natural
// order, new-page flow (folder pick-or-create → name), per-folder filename
// uniqueness, and search by file name or by content.
import { type FormEvent, useMemo, useState } from 'react'
import {
  filesInFolderOf,
  searchFilesByContent,
  searchFilesByName,
  useNotebookStore,
} from '../store/notebookStore'

function allFoldersFlat(
  folders: Record<string, { id: string; name: string; parentId: string | null }>,
): { id: string; name: string }[] {
  return Object.values(folders)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ id: f.id, name: f.name }))
}

/**
 * New-page action (DESIGN.md §2.2): "clicking it first asks the user to
 * either create a new folder or pick an existing one, and only then
 * prompts for the file name."
 */
function NewPageFlow({ onClose }: { onClose: () => void }) {
  const folders = useNotebookStore((s) => s.folders)
  const createFolder = useNotebookStore((s) => s.createFolder)
  const createFile = useNotebookStore((s) => s.createFile)
  const selectFolder = useNotebookStore((s) => s.selectFolder)
  const selectFile = useNotebookStore((s) => s.selectFile)

  const [step, setStep] = useState<'folder' | 'name'>('folder')
  const [folderChoice, setFolderChoice] = useState<'existing' | 'new'>('existing')
  const [existingFolderId, setExistingFolderId] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const flatFolders = allFoldersFlat(folders)

  const confirmFolder = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (folderChoice === 'existing') {
      if (!existingFolderId) {
        setError('Pick a folder.')
        return
      }
      setFolderId(existingFolderId)
      setStep('name')
      return
    }
    const result = createFolder(null, newFolderName)
    if (!result.ok) {
      setError(result.error ?? 'Could not create folder.')
      return
    }
    setFolderId(result.id!)
    setStep('name')
  }

  const confirmFile = (e: FormEvent) => {
    e.preventDefault()
    const result = createFile(folderId!, fileName)
    if (!result.ok) {
      setError(result.error ?? 'Could not create file.')
      return
    }
    selectFolder(folderId!)
    selectFile(result.id!)
    onClose()
  }

  return (
    <div role="dialog" aria-label="New page" className="absolute inset-x-2 top-10 z-10 rounded border border-gray-300 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
      {step === 'folder' && (
        <form onSubmit={confirmFolder} className="flex flex-col gap-2">
          <p className="text-sm font-medium">Choose a folder</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={folderChoice === 'existing'}
              onChange={() => setFolderChoice('existing')}
            />
            Existing folder
          </label>
          {folderChoice === 'existing' && (
            <select
              aria-label="Existing folder"
              className="rounded border border-gray-300 px-1 py-0.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              value={existingFolderId}
              onChange={(e) => setExistingFolderId(e.target.value)}
            >
              <option value="">Select…</option>
              {flatFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={folderChoice === 'new'} onChange={() => setFolderChoice('new')} />
            New folder
          </label>
          {folderChoice === 'new' && (
            <input
              aria-label="New folder name"
              className="rounded border border-gray-300 px-1 py-0.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
          )}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-sm text-gray-500">
              Cancel
            </button>
            <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-sm text-white">
              Next
            </button>
          </div>
        </form>
      )}

      {step === 'name' && (
        <form onSubmit={confirmFile} className="flex flex-col gap-2">
          <p className="text-sm font-medium">Name the file</p>
          <input
            autoFocus
            aria-label="File name"
            className="rounded border border-gray-300 px-1 py-0.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            value={fileName}
            onChange={(e) => {
              setFileName(e.target.value)
              setError(null)
            }}
          />
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-sm text-gray-500">
              Cancel
            </button>
            <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-sm text-white">
              Create
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

type SearchMode = 'name' | 'content'

export function PageList() {
  const selectedFolderId = useNotebookStore((s) => s.selectedFolderId)
  const allFiles = useNotebookStore((s) => s.files)
  const selectedFileId = useNotebookStore((s) => s.selectedFileId)
  const selectFile = useNotebookStore((s) => s.selectFile)

  const [showNewPage, setShowNewPage] = useState(false)
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('name')

  const isSearching = query.trim().length > 0
  const files = useMemo(
    () => (selectedFolderId ? filesInFolderOf(allFiles, selectedFolderId) : []),
    [allFiles, selectedFolderId],
  )
  const searchResults = useMemo(() => {
    if (!isSearching) return []
    return searchMode === 'name' ? searchFilesByName(allFiles, query) : searchFilesByContent(allFiles, query)
  }, [allFiles, isSearching, query, searchMode])
  const visibleFiles = isSearching ? searchResults : files

  return (
    <section
      className="relative flex w-[170px] shrink-0 flex-col border-r border-gray-200 dark:border-gray-800"
      data-testid="page-list"
      aria-label="Pages"
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold text-gray-500">Pages</span>
        <button
          type="button"
          aria-label="New page"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setShowNewPage(true)}
        >
          +
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 pb-1">
        <input
          aria-label="Search pages"
          placeholder="Search…"
          className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-800"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Search mode"
          className="rounded border border-gray-300 px-0.5 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-800"
          value={searchMode}
          onChange={(e) => setSearchMode(e.target.value as SearchMode)}
        >
          <option value="name">Name</option>
          <option value="content">Contents</option>
        </select>
      </div>

      <ul className="flex-1 overflow-y-auto px-1" aria-label={isSearching ? 'Search results' : 'Files'}>
        {visibleFiles.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => selectFile(file.id)}
              className={
                'w-full truncate rounded px-1 py-1 text-left text-sm ' +
                (file.id === selectedFileId
                  ? 'border-l-2 border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-l-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800')
              }
            >
              {file.name}
            </button>
          </li>
        ))}
        {visibleFiles.length === 0 && (
          <li className="p-2 text-sm text-gray-400">
            {isSearching ? 'No matches' : selectedFolderId ? 'No pages yet' : 'Select a folder'}
          </li>
        )}
      </ul>

      {showNewPage && <NewPageFlow onClose={() => setShowNewPage(false)} />}
    </section>
  )
}
