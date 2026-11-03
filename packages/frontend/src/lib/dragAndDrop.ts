// Shared drag-and-drop payload for moving a folder or file into another
// folder (SectionSidebar's folder tree, and PageList's files dragged across
// into it) — one small helper so both panels agree on the same
// dataTransfer MIME type and JSON shape rather than each hand-rolling it.
import type { DragEvent } from 'react'

export const DRAG_MIME = 'application/x-flownote-item'

export interface DragPayload {
  kind: 'folder' | 'file'
  id: string
}

export function setDragPayload(e: DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

/**
 * Only reliable inside a `drop` handler — most browsers withhold
 * `getData`'s actual value during `dragover`/`dragenter` (only `.types` is
 * readable then), so drop targets must decide *whether* to accept a drag
 * from `e.dataTransfer.types.includes(DRAG_MIME)` and defer reading the
 * payload itself until the drop.
 */
export function getDragPayload(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_MIME)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      ((parsed as DragPayload).kind === 'folder' || (parsed as DragPayload).kind === 'file') &&
      typeof (parsed as DragPayload).id === 'string'
    ) {
      return parsed as DragPayload
    }
    return null
  } catch {
    return null
  }
}
