// Collision primitives — DESIGN.md §4.6. Only the pieces `CanvasRoot`'s
// click-to-create needs (`overlaps`, `findFreePosition`) land here now;
// `resolvePosition()` and `clampResizeWidth()` are drag/resize-time
// functions that belong to Phase 3 (EXECUTION_PLAN.md) along with this
// file's 100%-coverage test pass and the AABB cache wiring. Keep these two
// pure and dependency-free so Phase 3 can extend the module in place.

/** Minimum gap enforced between segment boundaries (DESIGN.md §4.1/§4.6). */
export const MIN_GAP = 8

export interface AABB {
  x: number
  y: number
  w: number
  h: number
}

/** True if two boxes come within `MIN_GAP` of touching (inclusive of the gap itself). */
export function overlaps(a: AABB, b: AABB, gap: number = MIN_GAP): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

/**
 * Finds the nearest free position for a box of size `w`x`h` starting from
 * `(x, y)`, keeping at least `MIN_GAP` from every box in `existing`. Search
 * strategy: try the requested point, then nudge straight down in `h + gap`
 * steps (segments stack downward on the canvas) — sufficient for
 * click-to-create; a fuller free-space search is Phase 3's concern.
 */
export function findFreePosition(x: number, y: number, w: number, h: number, existing: AABB[]): { x: number; y: number } {
  let candidateY = y
  const maxAttempts = 500
  for (let i = 0; i < maxAttempts; i++) {
    const candidate: AABB = { x, y: candidateY, w, h }
    const collides = existing.some((box) => overlaps(candidate, box))
    if (!collides) return { x, y: candidateY }
    candidateY += h + MIN_GAP
  }
  return { x, y: candidateY }
}
