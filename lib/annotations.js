/**
 * Plugin-owned, durable annotations. No DSH runtime or global configuration is
 * touched. Supply a plugin-specific directory; operations are serialized across
 * store instances in this process. One Host process must own that directory:
 * this is not a cross-process database or a file-identity/content hash service.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const queues = new Map()
const TYPES = new Set(['bookmark', 'highlight', 'note'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELDS = new Set(['id', 'type', 'pdfPage', 'blockId', 'crop', 'rects', 'quote', 'note', 'tags', 'scope', 'createdAt', 'updatedAt'])

function invalid(message) {
  return Object.assign(new TypeError(`Invalid annotation: ${message}`), { code: 'ANNOTATION_VALIDATION' })
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`)
}

function string(value, label, max) {
  if (typeof value !== 'string' || value.length > max) throw invalid(`${label} must be a string of at most ${max} characters`)
  return value
}

function integer(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) throw invalid(`${label} must be an integer >= ${minimum}`)
  return value
}

function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid('id must be a UUID')
  return value.toLowerCase()
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw invalid(`${label} must be an ISO timestamp`)
  }
  return value
}

function rectangle(value, label) {
  object(value, label)
  if (Object.keys(value).some(key => !['x', 'y', 'width', 'height'].includes(key))) throw invalid(`${label} contains unknown fields`)
  const result = {}
  for (const key of ['x', 'y', 'width', 'height']) {
    const number = value[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) {
      throw invalid(`${label}.${key} must be a finite normalized number in [0,1]`)
    }
    result[key] = Object.is(number, -0) ? 0 : number
  }
  if (result.width === 0 || result.height === 0 || result.x + result.width > 1 + 1e-10 || result.y + result.height > 1 + 1e-10) {
    throw invalid(`${label} must have positive area and fit inside the page`)
  }
  return result
}

/** Windows spelling/case aliases share a document; distinct paths never do. */
function documentIdentity(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) throw invalid('documentPath must be a nonempty absolute path')
  let name = value
  if (/^\\\\\?\\UNC\\/i.test(name)) name = `\\\\${name.slice(8)}`
  else if (/^\\\\\?\\[a-z]:\\/i.test(name)) name = name.slice(4)
  const windows = /^[a-z]:/i.test(name) || /^\\\\/.test(name) || process.platform === 'win32'
  const parser = windows ? path.win32 : path.posix
  if (!parser.isAbsolute(name) || (windows && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(name))) {
    throw invalid('documentPath must be absolute (drive-relative paths are not accepted)')
  }
  name = parser.normalize(name)
  if (name.length > parser.parse(name).root.length) name = name.replace(windows ? /[\\/]+$/ : /\/+$/, '')
  return windows ? name.toLowerCase() : name
}

function normalizeAnnotation(input, previous, stored = false) {
  object(input, 'annotation')
  for (const key of Object.keys(input)) if (!FIELDS.has(key)) throw invalid(`unknown field ${key}`)
  if (stored) {
    for (const key of ['id', 'type', 'pdfPage', 'quote', 'note', 'rects', 'tags', 'scope', 'createdAt', 'updatedAt']) {
      if (!Object.hasOwn(input, key)) throw invalid(`stored ${key} is missing`)
    }
    if (input.crop === null || input.blockId === null) throw invalid('stored optional fields must be omitted rather than null')
  }
  const value = { ...previous, ...input }
  if (!TYPES.has(value.type)) throw invalid('type must be bookmark, highlight or note')
  const result = {
    id: value.id === undefined ? randomUUID() : id(value.id),
    type: value.type,
    pdfPage: integer(value.pdfPage, 'pdfPage', 1),
    quote: string(value.quote === undefined ? '' : value.quote, 'quote', 8000),
    note: string(value.note === undefined ? '' : value.note, 'note', 20000),
  }
  if (value.blockId !== undefined && value.blockId !== null) result.blockId = integer(value.blockId, 'blockId', 0)
  if (value.crop !== undefined && value.crop !== null) result.crop = rectangle(value.crop, 'crop')
  if (value.rects !== undefined && (!Array.isArray(value.rects) || value.rects.length > 256)) throw invalid('rects must be an array with at most 256 rectangles')
  result.rects = (value.rects ?? []).map((rect, index) => rectangle(rect, `rects[${index}]`))
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 16)) throw invalid('tags must be an array with at most 16 strings')
  result.tags = (value.tags ?? []).map((tag, index) => string(tag, `tags[${index}]`, 80))
  result.scope = result.crop !== undefined || result.rects.length > 0 ? 'region' : 'page'
  if (input.scope !== undefined && input.scope !== result.scope) throw invalid('scope must agree with crop/rects')
  // Accept a returned annotation for round trips, but never let clients choose
  // the persisted creation/update clock or overwrite creation time on edits.
  if (input.createdAt !== undefined) timestamp(input.createdAt, 'createdAt')
  if (input.updatedAt !== undefined) timestamp(input.updatedAt, 'updatedAt')
  if (stored) {
    result.createdAt = timestamp(input.createdAt, 'createdAt')
    result.updatedAt = timestamp(input.updatedAt, 'updatedAt')
    if (result.updatedAt < result.createdAt) throw invalid('updatedAt precedes createdAt')
    if (input.scope !== result.scope || input.id === undefined) throw invalid('stored id/scope is missing')
  } else {
    const now = Date.now()
    result.createdAt = previous?.createdAt ?? new Date(now).toISOString()
    result.updatedAt = new Date(Math.max(now, Date.parse(previous?.updatedAt ?? result.createdAt))).toISOString()
  }
  return result
}

function serialized(key, operation) {
  const pending = (queues.get(key) ?? Promise.resolve()).then(operation)
  // Keep a fulfilled tail so one failed operation never poisons later work.
  const tail = pending.catch(() => {})
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return pending
}

async function replaceFile(temporary, destination) {
  // Rename replaces an existing file atomically on Windows; transient readers,
  // scanners and indexers can briefly deny it. Never unlink the good file first.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, destination)
      return
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(error.code) || attempt >= 5) throw error
      await delay(10 * 2 ** attempt)
    }
  }
}

/**
 * All methods return Promises. list -> detached Annotation[] in creation order;
 * upsert -> complete saved Annotation (partial edits require an existing id);
 * remove -> boolean; export -> detached {schemaVersion,documentPath,annotations}.
 * null clears optional blockId/crop; [] clears rects/tags; '' clears quote/note.
 * Validation errors have code ANNOTATION_VALIDATION. Malformed existing files
 * have code ANNOTATION_CORRUPT and are never replaced by mutating operations.
 */
export function createAnnotationStore({ directory } = {}) {
  if (typeof directory !== 'string' || directory.length === 0 || directory.includes('\0')) throw invalid('directory must be a nonempty path')
  const root = path.resolve(directory)
  const storageKey = process.platform === 'win32' ? root.toLowerCase() : root

  function location(documentPath) {
    const document = documentIdentity(documentPath)
    const digest = createHash('sha256').update(document, 'utf8').digest('hex')
    return { document, file: path.join(root, `${digest}.json`), key: `${storageKey}\0${digest}` }
  }

  async function load(target) {
    let text
    try {
      text = await readFile(target.file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, documentPath: target.document, annotations: [] }
      throw error
    }
    try {
      const data = JSON.parse(text)
      object(data, 'stored document')
      if (data.schemaVersion !== 1 || data.documentPath !== target.document || !Array.isArray(data.annotations)) throw invalid('stored document schema/path does not match')
      if (Object.keys(data).some(key => !['schemaVersion', 'documentPath', 'annotations'].includes(key))) throw invalid('stored document contains unknown fields')
      const annotations = data.annotations.map(item => normalizeAnnotation(item, undefined, true))
      if (new Set(annotations.map(item => item.id)).size !== annotations.length) throw invalid('stored document has duplicate ids')
      return { schemaVersion: 1, documentPath: target.document, annotations }
    } catch (cause) {
      throw Object.assign(new Error(`Corrupt annotation file ${target.file}: ${cause.message}`, { cause }), { code: 'ANNOTATION_CORRUPT' })
    }
  }

  async function save(target, data) {
    await mkdir(root, { recursive: true })
    const temporary = `${target.file}.${randomUUID()}.tmp`
    let handle
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await replaceFile(temporary, target.file)
    } finally {
      if (handle !== undefined) await handle.close()
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }

  return {
    async list(documentPath) {
      const target = location(documentPath)
      return serialized(target.key, async () => (await load(target)).annotations)
    },
    async upsert(documentPath, annotation) {
      const target = location(documentPath)
      // Snapshot caller-owned fields before queueing; no mutable references can
      // change what this operation validates or writes while another one runs.
      object(annotation, 'annotation')
      const snapshot = structuredClone(annotation)
      return serialized(target.key, async () => {
        const data = await load(target)
        const requestedId = snapshot.id === undefined ? undefined : id(snapshot.id)
        const index = requestedId === undefined ? -1 : data.annotations.findIndex(item => item.id === requestedId)
        if (requestedId !== undefined && index < 0) throw invalid('id does not exist in this document; omit id when creating')
        const saved = normalizeAnnotation(snapshot, data.annotations[index])
        if (index < 0) data.annotations.push(saved)
        else data.annotations[index] = saved
        await save(target, data)
        return saved
      })
    },
    async remove(documentPath, annotationId) {
      const target = location(documentPath)
      const requestedId = id(annotationId)
      return serialized(target.key, async () => {
        const data = await load(target)
        const index = data.annotations.findIndex(item => item.id === requestedId)
        if (index < 0) return false
        data.annotations.splice(index, 1)
        await save(target, data)
        return true
      })
    },
    async export(documentPath) {
      const target = location(documentPath)
      return serialized(target.key, () => load(target))
    },
  }
}
