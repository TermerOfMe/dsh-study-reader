/** Durable plugin-owned last positions. One Host process owns the directory. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const queues = new Map()
const revisions = new Map() // Bounded per-writer ordering, shared across store instances.
const invalid = message => Object.assign(new TypeError(`Invalid reading position: ${message}`), { code: 'READING_POSITION_VALIDATION' })
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('expected an object')
}
function identity(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw invalid('documentPath must be an absolute path')
  let name = value
  if (/^\\\\\?\\UNC\\/i.test(name)) name = `\\\\${name.slice(8)}`
  else if (/^\\\\\?\\[a-z]:\\/i.test(name)) name = name.slice(4)
  const windows = /^[a-z]:/i.test(name) || /^\\\\/.test(name) || process.platform === 'win32'
  const parser = windows ? path.win32 : path.posix
  if (!parser.isAbsolute(name) || (windows && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(name))) throw invalid('documentPath must be absolute')
  name = parser.normalize(name)
  if (name.length > parser.parse(name).root.length) name = name.replace(windows ? /[\\/]+$/ : /\/+$/, '')
  return windows ? name.toLowerCase() : name
}
export function validateReadingPosition(input, stored = false) {
  object(input)
  const fields = stored ? ['pageNumber', 'x', 'y', 'updatedAt'] : ['pageNumber', 'x', 'y']
  if (Object.keys(input).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(input, key))) throw invalid('missing or unknown fields')
  if (!Number.isSafeInteger(input.pageNumber) || input.pageNumber < 1) throw invalid('pageNumber must be a positive safe integer')
  for (const key of ['x', 'y']) if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 1) throw invalid(`${key} must be finite and in [0,1]`)
  if (stored && (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt)) || new Date(input.updatedAt).toISOString() !== input.updatedAt)) throw invalid('updatedAt must be an ISO timestamp')
  return { pageNumber: input.pageNumber, x: input.x === 0 ? 0 : input.x, y: input.y === 0 ? 0 : input.y, ...(stored ? { updatedAt: input.updatedAt } : {}) }
}
function serialized(key, operation) {
  const pending = (queues.get(key) ?? Promise.resolve()).then(operation)
  const tail = pending.catch(() => {})
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return pending
}
async function replaceFile(temporary, destination) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, destination); return } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(error.code) || attempt >= 5) throw error
      await delay(10 * 2 ** attempt)
    }
  }
}
export function createReadingPositionStore({ directory } = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')) throw invalid('directory must be a nonempty path')
  const root = path.resolve(directory)
  const storageKey = process.platform === 'win32' ? root.toLowerCase() : root
  function target(documentPath) {
    const document = identity(documentPath)
    const digest = createHash('sha256').update(document).digest('hex')
    return { document, file: path.join(root, digest + '.json'), key: storageKey + '\0' + digest }
  }
  async function load(item) {
    let text
    try { text = await readFile(item.file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    try {
      const data = JSON.parse(text)
      object(data)
      if (Object.keys(data).some(key => !['schemaVersion', 'documentPath', 'position'].includes(key)) || data.schemaVersion !== 1 || data.documentPath !== item.document) throw invalid('stored schema or document mismatch')
      return validateReadingPosition(data.position, true)
    } catch (cause) {
      throw Object.assign(new Error('Saved reading position is corrupt; original data was preserved.', { cause }), { code: 'READING_POSITION_CORRUPT' })
    }
  }
  return {
    async get(documentPath) {
      const item = target(documentPath)
      return serialized(item.key, () => load(item))
    },
    async set(documentPath, position, ordering = {}) {
      const item = target(documentPath)
      const snapshot = validateReadingPosition(position)
      const { writerId, revision } = ordering
      const ordered = writerId !== undefined || revision !== undefined
      if (ordered && (typeof writerId !== 'string' || writerId.length < 1 || writerId.length > 100 || !Number.isSafeInteger(revision) || revision < 1)) throw invalid('writerId and positive revision must be supplied together')
      const writerKey = ordered ? item.key + '\0' + writerId : null
      return serialized(item.key, async () => {
        const previous = await load(item)
        if (ordered && revision <= (revisions.get(writerKey) ?? 0)) return previous
        const saved = { ...snapshot, updatedAt: new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt ?? '1970-01-01T00:00:00.000Z'))).toISOString() }
        await mkdir(root, { recursive: true })
        const temporary = item.file + '.' + randomUUID() + '.tmp'
        let handle
        try {
          handle = await open(temporary, 'wx', 0o600)
          await handle.writeFile(JSON.stringify({ schemaVersion: 1, documentPath: item.document, position: saved }) + '\n', 'utf8')
          await handle.sync()
          await handle.close(); handle = undefined
          await replaceFile(temporary, item.file)
        } finally {
          if (handle) await handle.close()
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
        if (ordered) {
          revisions.delete(writerKey)
          revisions.set(writerKey, revision)
          while (revisions.size > 1024) revisions.delete(revisions.keys().next().value)
        }
        return saved
      })
    },
  }
}
