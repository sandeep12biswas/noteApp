// Natural ordering — DESIGN.md §2.1/§2.2: folders and files are shown in
// natural order (e.g. "Folder 2" before "Folder 10", not lexicographic).
// Splits each name into alternating digit/non-digit chunks and compares
// digit chunks numerically, everything else via locale-aware string
// comparison (case-insensitive, so "apple" and "Apple" sort together).
const CHUNK = /(\d+)|(\D+)/g

function chunks(value: string): string[] {
  return value.match(CHUNK) ?? []
}

export function naturalCompare(a: string, b: string): number {
  const chunksA = chunks(a)
  const chunksB = chunks(b)
  const len = Math.max(chunksA.length, chunksB.length)

  for (let i = 0; i < len; i++) {
    const chunkA = chunksA[i]
    const chunkB = chunksB[i]
    if (chunkA === undefined) return -1
    if (chunkB === undefined) return 1

    const numA = /^\d+$/.test(chunkA) ? Number(chunkA) : null
    const numB = /^\d+$/.test(chunkB) ? Number(chunkB) : null

    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB
      continue
    }

    const cmp = chunkA.localeCompare(chunkB, undefined, { sensitivity: 'base' })
    if (cmp !== 0) return cmp
  }

  return 0
}

export function naturalSortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(key(a), key(b)))
}
