/**
 * Structural equality for JSON values, ignoring object key order — the
 * backend's JSON (serde_json) sorts keys, TipTap's `getJSON()` doesn't, so
 * comparing serialised strings would call every segment "changed".
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const arr = b as unknown[]
    return a.length === arr.length && a.every((item, i) => deepEqual(item, arr[i]))
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
