// Collision primitives — DESIGN.md §4.6. Pure, dependency-free TypeScript
// so they can run synchronously on every `mousemove`/`ResizeObserver` tick
// (DESIGN.md §10 "Collision performance at scale" — no store/DOM access
// here, callers own that).

/** Minimum gap enforced between segment boundaries (DESIGN.md §4.1/§4.6). */
export const MIN_GAP = 8

/** Distance within which a segment's border "brightens" during drag (DESIGN.md Phase 3 "Gap highlight"). */
export const GAP_HIGHLIGHT_THRESHOLD = 16

/** Segments never shrink narrower than this, regardless of neighbours (Phase 3 "clampResizeWidth"). */
export const MIN_SEGMENT_WIDTH = 120

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

/** The straight-line distance between two boxes' nearest edges — 0 when overlapping/touching. */
function gapBetween(a: AABB, b: AABB): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Resolves a dragged box's desired position against solid neighbours
 * (DESIGN.md §4.6): pushes it out along whichever axis needs the smaller
 * correction (a minimum-translation-vector depenetration), repeated up to
 * 20 times in case resolving one collision creates another. Clamped to
 * non-negative coordinates — the canvas has no space above/left of origin.
 * Called on every `mousemove`; direct-DOM-mutate the result rather than
 * routing it through React state for 60fps (SegmentHost does this).
 */
export function resolvePosition(moving: AABB, existing: AABB[], gap: number = MIN_GAP): { x: number; y: number } {
  let x = moving.x
  let y = moving.y
  const { w, h } = moving

  for (let iteration = 0; iteration < 20; iteration++) {
    const hit = existing.find((box) => overlaps({ x, y, w, h }, box, gap))
    if (!hit) break

    const centerX = x + w / 2
    const centerY = y + h / 2
    const hitCenterX = hit.x + hit.w / 2
    const hitCenterY = hit.y + hit.h / 2

    const neededX = (w + hit.w) / 2 + gap - Math.abs(centerX - hitCenterX)
    const neededY = (h + hit.h) / 2 + gap - Math.abs(centerY - hitCenterY)

    // Push along whichever axis needs the smaller nudge to clear — the
    // less disruptive correction, and what keeps a drag feeling like
    // sliding along a solid neighbour rather than snapping away from it.
    if (neededX <= neededY) {
      x += centerX < hitCenterX ? -neededX : neededX
    } else {
      y += centerY < hitCenterY ? -neededY : neededY
    }
  }

  return { x: Math.max(0, x), y: Math.max(0, y) }
}

/**
 * Clamps a proposed resize width so the segment's right edge never crosses
 * `MIN_GAP` of a neighbour that overlaps its vertical extent — only boxes
 * at or right of `x` can block growth; boxes already fully to the left
 * never do, and shrinking is always allowed down to `MIN_SEGMENT_WIDTH`.
 */
export function clampResizeWidth(
  segment: { x: number; y: number; h: number },
  proposedW: number,
  existing: AABB[],
  gap: number = MIN_GAP,
): number {
  let maxW = proposedW
  for (const box of existing) {
    const verticallyOverlaps = segment.y < box.y + box.h + gap && segment.y + segment.h + gap > box.y
    if (!verticallyOverlaps) continue
    if (box.x < segment.x) continue // to the left — can't block rightward growth
    const allowed = box.x - gap - segment.x
    if (allowed < maxW) maxW = allowed
  }
  return Math.max(MIN_SEGMENT_WIDTH, maxW)
}

/** Ids of boxes in `others` within `threshold` of `box` — drives the "gap highlight" during drag. */
export function idsWithinGap<T extends AABB & { id: string }>(box: AABB, others: T[], threshold: number = GAP_HIGHLIGHT_THRESHOLD): string[] {
  return others.filter((o) => gapBetween(box, o) <= threshold).map((o) => o.id)
}

export interface GapLine {
  x: number
  y: number
  w: number
  h: number
  /** `vertical` = a north-south line spanning a horizontal gap; `horizontal` = an east-west line spanning a vertical gap. */
  orientation: 'horizontal' | 'vertical'
}

/**
 * The exact 1px dashed gap-indicator line between two boxes that are
 * cleanly separated along one axis (side-by-side or stacked, not
 * diagonally at a corner) — DESIGN.md Phase 3's gap highlight follow-up
 * ("a dashed line reading the actual gap", not just a brightened border).
 * Positioned at the midpoint between the two facing edges, spanning
 * whatever range the boxes overlap along the perpendicular axis. Returns
 * `null` for boxes with no clean shared axis (diagonal/corner-adjacent, or
 * already touching/overlapping on both axes) — there's no single
 * unambiguous line to draw for those, so the caller falls back to the
 * border highlight alone.
 */
export function gapLineFor(a: AABB, b: AABB): GapLine | null {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)

  if (dx > 0 && dy === 0) {
    const aIsLeft = a.x + a.w <= b.x
    const lineX = aIsLeft ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2
    const y = Math.max(a.y, b.y)
    const h = Math.min(a.y + a.h, b.y + b.h) - y
    return { x: lineX, y, w: 0, h, orientation: 'vertical' }
  }

  if (dy > 0 && dx === 0) {
    const aIsAbove = a.y + a.h <= b.y
    const lineY = aIsAbove ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2
    const x = Math.max(a.x, b.x)
    const w = Math.min(a.x + a.w, b.x + b.w) - x
    return { x, y: lineY, w, h: 0, orientation: 'horizontal' }
  }

  return null
}
