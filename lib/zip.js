/**
 * Minimal, dependency-free ZIP reader for OOXML packages (.docx/.pptx).
 *
 * Office files are ordinary ZIP archives. We use the central directory as the
 * authority and inflate entries with Node's zlib, so no third-party archive
 * package is needed. ZIP64 archives are deliberately rejected rather than
 * mis-parsed: an ordinary Office document never needs ZIP64, and a clear
 * failure is better than silent corruption.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const UTF8 = new TextDecoder('utf-8', { fatal: false })
const MAX_ENTRIES = 20_000
const MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024

function u16(view, offset) {
  return view.getUint16(offset, true)
}

function u32(view, offset) {
  return view.getUint32(offset, true)
}

export class ZipError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZipError'
  }
}

/**
 * Read a ZIP archive into a Map of normalized entry names -> bytes.
 * @param {Uint8Array} input
 * @returns {{ names: string[], has(name: string): boolean, get(name: string): Uint8Array | undefined, text(name: string): string | undefined }}
 */
export function openZip(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 22) {
    throw new ZipError('文件不是有效的 Office（ZIP）文档。')
  }
  const bytes = input
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const floor = Math.max(0, bytes.byteLength - 65_557)
  for (let at = bytes.byteLength - 22; at >= floor; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIG) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new ZipError('未找到 Office 文档的 ZIP 目录。')

  const disk = u16(view, eocd + 4)
  const centralDisk = u16(view, eocd + 6)
  const count = u16(view, eocd + 10)
  const centralOffset = u32(view, eocd + 16)
  if (disk !== 0 || centralDisk !== 0) throw new ZipError('不支持分卷 ZIP 文档。')
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError('暂不支持 ZIP64 格式的 Office 文档。')
  if (count > MAX_ENTRIES) throw new ZipError('Office 文档包含的条目过多。')

  const entries = new Map()
  let total = 0
  let offset = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_SIG) {
      throw new ZipError('Office 文档的 ZIP 目录已损坏。')
    }
    const flags = u16(view, offset + 8)
    const method = u16(view, offset + 10)
    const compressed = u32(view, offset + 20)
    const uncompressed = u32(view, offset + 24)
    const nameLength = u16(view, offset + 28)
    const extraLength = u16(view, offset + 30)
    const commentLength = u16(view, offset + 32)
    const localOffset = u32(view, offset + 42)
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('暂不支持 ZIP64 格式的 Office 文档。')
    }
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > bytes.byteLength) throw new ZipError('Office 文档的 ZIP 名称区已损坏。')
    let name = UTF8.decode(bytes.subarray(nameStart, nameEnd))
    if ((flags & 0x0800) === 0) {
      // Legacy CP437 names are not used by Office media; a latin1 decode keeps
      // the string intact enough to address known OOXML parts.
      name = Buffer.from(bytes.subarray(nameStart, nameEnd)).toString('latin1')
    }
    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipError(`Office 文档条目 ${name} 的本地头已损坏。`)
    }
    const localNameLength = u16(view, localOffset + 26)
    const localExtraLength = u16(view, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressed
    if (dataEnd > bytes.byteLength) throw new ZipError(`Office 文档条目 ${name} 超出文件范围。`)
    if (uncompressed > MAX_TOTAL_UNCOMPRESSED || total + uncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new ZipError('Office 文档解压后体积过大。')
    }
    total += uncompressed
    if (!name.endsWith('/')) {
      const raw = bytes.subarray(dataStart, dataEnd)
      let data
      if (method === 0) {
        data = raw.slice()
      } else if (method === 8) {
        try {
          data = new Uint8Array(inflateRawSync(raw))
        } catch {
          throw new ZipError(`无法解压 Office 文档条目 ${name}。`)
        }
      } else {
        throw new ZipError(`暂不支持 Office 文档的压缩方式（${method}）。`)
      }
      entries.set(name, data)
    }
    offset = nameEnd + extraLength + commentLength
  }

  return {
    names: [...entries.keys()],
    has(name) {
      return entries.has(name)
    },
    get(name) {
      return entries.get(name)
    },
    text(name) {
      const data = entries.get(name)
      if (data === undefined) return undefined
      return UTF8.decode(data)
    },
  }
}

/** Decode the XML entities OOXML text runs can carry. */
export function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function safeCodePoint(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return ''
  try {
    return String.fromCodePoint(value)
  } catch {
    return ''
  }
}

/** Read one attribute by local name, tolerating a namespace prefix. */
export function xmlAttr(attributes, localName) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${escaped}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes)
  return match === null ? undefined : decodeXmlEntities(match[1])
}
