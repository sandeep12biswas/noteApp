// A minimal, dependency-free ZIP writer — `pack` (cli.ts) uses this to
// produce a plugin's `.fnp` file. Deliberately store-only (no DEFLATE
// compression): a plugin's assets are a handful of small JS/HTML files, so
// compression buys little, and hand-rolling just the "store" method keeps
// this whole file self-contained rather than pulling in a zip dependency
// for what the rest of this repo already treats as a small, auditable
// surface (see e.g. flownote-core's own migration runner, written by hand
// for the same reason). Not signed — `.fnp` "signed zip" per DESIGN.md
// §9.6 is aspirational; there's no signing infra anywhere in this repo yet
// (and nothing on the install side reads a `.fnp` at all yet either — see
// this file's README section on that gap).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time fields the ZIP format stores timestamps as. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dosDate }
}

export interface ZipEntry {
  name: string
  data: Buffer
}

/** Builds a complete ZIP archive (local headers + central directory + EOCD) from a flat list of entries, all stored uncompressed. */
export function createZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime(new Date())
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed to extract
    localHeader.writeUInt16LE(0, 6) // general purpose flag
    localHeader.writeUInt16LE(0, 8) // compression method: store
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(date, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(size, 18) // compressed size == uncompressed (store)
    localHeader.writeUInt32LE(size, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra field length

    localParts.push(localHeader, nameBuf, entry.data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed to extract
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(date, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(size, 20)
    centralHeader.writeUInt32LE(size, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra field length
    centralHeader.writeUInt16LE(0, 32) // file comment length
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal file attributes
    centralHeader.writeUInt32LE(0, 38) // external file attributes
    centralHeader.writeUInt32LE(offset, 42) // relative offset of local header

    centralParts.push(centralHeader, nameBuf)

    offset += localHeader.length + nameBuf.length + entry.data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8) // records on this disk
  eocd.writeUInt16LE(entries.length, 10) // total records
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16) // offset of start of central directory
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, centralDirectory, eocd])
}
