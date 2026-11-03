// Built-in folder icon set — DESIGN.md §2.1 "changeable folder icons".
// Plain emoji rather than a bundled SVG set: no new asset pipeline needed,
// same "small array of literal values" shape segmentColors.ts's palette
// already uses, and emoji render identically everywhere without a font.
// `null` (the default, unset state) renders as `DEFAULT_FOLDER_ICON` — kept
// separate from the pickable list so it's always the first, unambiguous
// "back to default" choice in the icon menu.
export const DEFAULT_FOLDER_ICON = '📁'

export const FOLDER_ICONS = ['📁', '📂', '⭐', '📌', '💼', '📚', '🎯', '🗂️', '💡', '🏠', '🔒', '✅'] as const

export type FolderIcon = (typeof FOLDER_ICONS)[number]
