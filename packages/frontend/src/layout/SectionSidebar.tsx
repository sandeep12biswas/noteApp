// Folder sidebar — DESIGN.md §2.1: folder-only tree, auto-capitalized
// names, file counts, expandable sub-folders, natural order, changeable
// icons (built-in set — see FolderIconMenu.tsx for why "external import"
// isn't built).
import { type KeyboardEvent, useMemo, useRef, useState } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { DEFAULT_FOLDER_ICON } from '../lib/folderIcons'
import { useExtensionRegistry } from '../store/extensionRegistry'
import { type Folder, childFoldersOf, fileCountOf, useNotebookStore } from '../store/notebookStore'
import { useUIStore } from '../store/uiStore'
import { FolderContextMenu } from './FolderContextMenu'
import { FolderIconMenu } from './FolderIconMenu'

function NewFolderInput({ parentId, onDone }: { parentId: string | null; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createFolder = useNotebookStore((s) => s.createFolder)

  const submit = () => {
    if (value.trim().length === 0) {
      onDone()
      return
    }
    const result = createFolder(parentId, value)
    if (result.ok) {
      onDone()
    } else {
      setError(result.error ?? 'Could not create folder.')
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') onDone()
  }

  return (
    <div className="px-1 py-0.5">
      <input
        autoFocus
        aria-label="New folder name"
        className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm outline-none"
        value={value}
        // Live auto-capitalize preview (DESIGN.md §2.1) — the store
        // capitalizes again on submit, this is just what the user sees
        // while typing.
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={onKeyDown}
        onBlur={submit}
      />
      {error && (
        <p role="alert" className="mt-0.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

function RenameFolderInput({ folder, onDone }: { folder: Folder; onDone: () => void }) {
  const [value, setValue] = useState(folder.name)
  const renameFolder = useNotebookStore((s) => s.renameFolder)

  const submit = () => {
    if (value.trim().length > 0 && value.trim() !== folder.name) renameFolder(folder.id, value)
    onDone()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') onDone()
  }

  return (
    <input
      autoFocus
      aria-label={`Rename ${folder.name}`}
      className="flex-1 rounded border border-blue-400 px-1 py-0.5 text-sm outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={submit}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function FolderNode({ folder, depth }: { folder: Folder; depth: number }) {
  const allFolders = useNotebookStore((s) => s.folders)
  const allFiles = useNotebookStore((s) => s.files)
  const childFolders = useMemo(() => childFoldersOf(allFolders, folder.id), [allFolders, folder.id])
  const fileCount = useMemo(() => fileCountOf(allFiles, folder.id), [allFiles, folder.id])
  const selectedFolderId = useNotebookStore((s) => s.selectedFolderId)
  const selectFolder = useNotebookStore((s) => s.selectFolder)
  const toggleExpanded = useNotebookStore((s) => s.toggleFolderExpanded)
  const setFolderIcon = useNotebookStore((s) => s.setFolderIcon)
  const deleteFolder = useNotebookStore((s) => s.deleteFolder)
  const [addingChild, setAddingChild] = useState(false)
  const [iconMenu, setIconMenu] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const iconButtonRef = useRef<HTMLButtonElement | null>(null)

  const hasChildren = childFolders.length > 0
  const isSelected = selectedFolderId === folder.id

  return (
    <li>
      <div
        className={
          'flex items-center gap-1 rounded px-1 py-0.5 text-sm ' +
          (isSelected ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-gray-100 dark:hover:bg-gray-800')
        }
        style={{ paddingLeft: depth * 12 }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={folder.expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            onClick={() => toggleExpanded(folder.id)}
            className="w-3 shrink-0 text-gray-400"
          >
            {folder.expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          ref={iconButtonRef}
          type="button"
          aria-label={`Change icon for ${folder.name}`}
          onClick={(e) => {
            e.stopPropagation()
            const rect = iconButtonRef.current?.getBoundingClientRect()
            setIconMenu(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: e.clientX, y: e.clientY })
          }}
          className="shrink-0 rounded text-sm hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          {folder.icon ?? DEFAULT_FOLDER_ICON}
        </button>
        {renaming ? (
          <RenameFolderInput folder={folder} onDone={() => setRenaming(false)} />
        ) : (
          <button
            type="button"
            onClick={() => selectFolder(folder.id)}
            className="flex-1 truncate text-left"
          >
            {folder.name}
          </button>
        )}
        <span className="text-xs text-gray-400" aria-label={`${fileCount} files`}>
          {fileCount}
        </span>
        <button
          type="button"
          aria-label={`New subfolder in ${folder.name}`}
          onClick={(e) => {
            e.stopPropagation()
            setAddingChild(true)
          }}
          className="shrink-0 text-xs text-gray-400 hover:text-blue-600"
        >
          +
        </button>
      </div>

      {iconMenu && (
        <FolderIconMenu
          x={iconMenu.x}
          y={iconMenu.y}
          activeIcon={folder.icon}
          onPick={(icon) => setFolderIcon(folder.id, icon)}
          onClose={() => setIconMenu(null)}
        />
      )}

      {contextMenu && (
        <FolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          folderName={folder.name}
          onNewSubfolder={() => setAddingChild(true)}
          onRename={() => setRenaming(true)}
          onDelete={() => deleteFolder(folder.id)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {(folder.expanded || addingChild) && (
        <ul>
          {folder.expanded &&
            childFolders.map((child) => (
              <FolderNode key={child.id} folder={child} depth={depth + 1} />
            ))}
          {addingChild && <NewFolderInput parentId={folder.id} onDone={() => setAddingChild(false)} />}
        </ul>
      )}
    </li>
  )
}

export function SectionSidebar() {
  const allFolders = useNotebookStore((s) => s.folders)
  const rootFolders = useMemo(() => childFoldersOf(allFolders, null), [allFolders])
  const [addingRoot, setAddingRoot] = useState(false)
  // Plugin-registered section tabs (DESIGN.md §9.2 `registerSectionTab`) —
  // empty until Phase 7's PluginManager populates the registry.
  const pluginSectionTabs = useExtensionRegistry((s) => s.sectionTabs)
  const activeView = useUIStore((s) => s.activeView)
  const setActiveView = useUIStore((s) => s.setActiveView)
  // Phase 6 "Accessibility pass" — same roving arrow-key nav as PageList's
  // file list, for the same reason (DESIGN.md "keyboard navigation in
  // section/page lists"); works across nested `FolderNode`s for free since
  // it queries every `button` descendant regardless of tree depth.
  const treeRef = useRef<HTMLUListElement | null>(null)
  useMenuKeyboardNav(treeRef, { autoFocus: false, itemSelector: 'button' })

  return (
    <aside
      className="flex w-40 shrink-0 flex-col border-r border-gray-200 dark:border-gray-800"
      data-testid="section-sidebar"
      aria-label="Folders"
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold text-gray-500">Folders</span>
        <button
          type="button"
          aria-label="New folder"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setAddingRoot(true)}
        >
          +
        </button>
      </div>
      <ul ref={treeRef} className="flex-1 overflow-y-auto px-1" aria-label="Folder tree">
        {rootFolders.map((folder) => (
          <FolderNode key={folder.id} folder={folder} depth={0} />
        ))}
        {addingRoot && <NewFolderInput parentId={null} onDone={() => setAddingRoot(false)} />}
        {rootFolders.length === 0 && !addingRoot && (
          <li className="p-2 text-sm text-gray-400">No folders yet</li>
        )}
      </ul>
      <div className="border-t border-gray-200 p-2 dark:border-gray-800" data-testid="plugins-tab">
        {/* Plugins tab — DESIGN.md §9.5 Plugin Manager UI entry point */}
        <button
          type="button"
          aria-pressed={activeView === 'plugins'}
          onClick={() => setActiveView(activeView === 'plugins' ? 'notebook' : 'plugins')}
          className={
            'text-sm ' + (activeView === 'plugins' ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300')
          }
        >
          Plugins
        </button>
        {Object.values(pluginSectionTabs).map((tab) => (
          <div key={`${tab.pluginId}/${tab.id}`} className="pt-1 text-xs text-gray-400">
            {tab.label}
          </div>
        ))}
      </div>
    </aside>
  )
}
