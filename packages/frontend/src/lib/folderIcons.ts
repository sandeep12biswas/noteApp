// Built-in folder icon set — DESIGN.md §2.1 "changeable folder icons".
// `Folder.icon` is a single string: either one of the lavender icons below
// (stored as `lavender:<name>`, drawn by layout/FolderIcon.tsx in the app's
// brand colour, issue #40) or an emoji (the original set, kept so existing
// choices still show and for anyone who prefers them). `null` — the
// default — draws the plain lavender folder.
export const LAVENDER_PREFIX = 'lavender:'

/** Lavender icons: a lavender folder with a white symbol on it. Order = picker order. */
export const LAVENDER_FOLDER_ICONS = [
  { name: 'folder', label: 'Folder' },
  { name: 'folder-open', label: 'Open folder' },
  { name: 'star', label: 'Star' },
  { name: 'pin', label: 'Pin' },
  { name: 'briefcase', label: 'Work' },
  { name: 'books', label: 'Books' },
  { name: 'target', label: 'Target' },
  { name: 'archive', label: 'Archive' },
  { name: 'idea', label: 'Idea' },
  { name: 'home', label: 'Home' },
  { name: 'lock', label: 'Private' },
  { name: 'check', label: 'Done' },
] as const

export type LavenderIconName = (typeof LAVENDER_FOLDER_ICONS)[number]['name']

export const EMOJI_FOLDER_ICONS = ['📁', '📂', '⭐', '📌', '💼', '📚', '🎯', '🗂️', '💡', '🏠', '🔒', '✅'] as const

/** What a folder with no icon of its own (`null`) shows. */
export const DEFAULT_FOLDER_ICON = `${LAVENDER_PREFIX}folder`

export function lavenderIconName(icon: string | null): LavenderIconName | null {
  const value = icon ?? DEFAULT_FOLDER_ICON
  if (!value.startsWith(LAVENDER_PREFIX)) return null
  const name = value.slice(LAVENDER_PREFIX.length)
  // An unknown lavender name (e.g. saved by a newer FlowNote) still draws a folder, never raw text.
  return LAVENDER_FOLDER_ICONS.some((i) => i.name === name) ? (name as LavenderIconName) : 'folder'
}
