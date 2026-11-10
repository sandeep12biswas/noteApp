// Draws a folder's icon (lib/folderIcons.ts): a lavender folder — with a
// white symbol for the themed set — or, for an emoji choice, the emoji.
// Sized in `em` so it follows the surrounding text like the emoji did.
import type { ReactElement } from 'react'
import { lavenderIconName, type LavenderIconName } from '../lib/folderIcons'

const W = { fill: 'none', stroke: '#fff', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

// Symbols sit on the folder's front panel, centred around (12, 14.6).
const SYMBOLS: Partial<Record<LavenderIconName, ReactElement>> = {
  star: <path d="M12 10.6l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" fill="#fff" />,
  pin: (
    <g {...W}>
      <circle cx="12" cy="13.2" r="1.9" fill="#fff" />
      <path d="M12 15.1v3" />
    </g>
  ),
  briefcase: (
    <g {...W}>
      <rect x="8.4" y="12.6" width="7.2" height="5" rx="1" />
      <path d="M10.6 12.6v-1.1h2.8v1.1" />
    </g>
  ),
  books: (
    <g {...W}>
      <path d="M9.3 11.4v6.4M11.6 11.4v6.4M13.6 11.7l1.9 5.9" />
    </g>
  ),
  target: (
    <g {...W}>
      <circle cx="12" cy="14.6" r="3.2" />
      <circle cx="12" cy="14.6" r=".9" fill="#fff" />
    </g>
  ),
  archive: (
    <g {...W}>
      <path d="M8.8 12.4h6.4M8.8 14.6h6.4M8.8 16.8h4.2" />
    </g>
  ),
  idea: (
    <g {...W}>
      <path d="M10.4 16.1a2.6 2.6 0 1 1 3.2 0v.8h-3.2z" />
      <path d="M10.9 18.5h2.2" />
    </g>
  ),
  home: (
    <g {...W}>
      <path d="M8.6 14.4l3.4-3 3.4 3M9.6 13.6v4.2h4.8v-4.2" />
    </g>
  ),
  lock: (
    <g {...W}>
      <rect x="9" y="13.6" width="6" height="4.4" rx="1" fill="#fff" />
      <path d="M10.4 13.6v-1.2a1.6 1.6 0 0 1 3.2 0v1.2" />
    </g>
  ),
  check: <path d="M9 14.8l2.1 2.1 3.9-4.2" {...W} strokeWidth={1.9} />,
}

export function FolderIcon({ icon, className = '' }: { icon: string | null; className?: string }) {
  const name = lavenderIconName(icon)
  if (!name) return <span className={className}>{icon}</span>
  const open = name === 'folder-open'
  return (
    <svg viewBox="0 0 24 24" className={'inline-block h-[1.15em] w-[1.15em] align-[-0.2em] ' + className} aria-hidden="true" data-folder-icon={name}>
      {/* back panel with tab */}
      <path
        d="M2.5 6.6A2.6 2.6 0 0 1 5.1 4h4.3c.5 0 1 .2 1.3.6l1.3 1.5h6.9a2.6 2.6 0 0 1 2.6 2.6v8.9a2.6 2.6 0 0 1-2.6 2.6H5.1a2.6 2.6 0 0 1-2.6-2.6z"
        className="fill-lavender-700 dark:fill-lavender-500"
      />
      {/* front panel (tilted forward when open) */}
      <path
        d={open ? 'M5.6 9.6h16.2c.9 0 1.5.9 1.2 1.7l-2.2 6.8a2.6 2.6 0 0 1-2.5 1.9H4.6c-1 0-1.7-1-1.3-1.9l1.2-7.4c.1-.6.6-1.1 1.1-1.1z' : 'M2.5 9.4h19v8.2a2.6 2.6 0 0 1-2.6 2.6H5.1a2.6 2.6 0 0 1-2.6-2.6z'}
        className="fill-lavender-500 dark:fill-lavender-400"
      />
      {SYMBOLS[name]}
    </svg>
  )
}
