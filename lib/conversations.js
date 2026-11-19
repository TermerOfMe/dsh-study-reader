/** Durable per-document conversation records; JSON data is never interpreted. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const queues = new Map()
const invalid = message => Object.assign(new TypeError(`Invalid conversation: ${message}`), { code: 'CONVERSATION_VALIDATION' })
const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('expected object') }
const id = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw invalid('invalid id'); return value }
function identity(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw invalid('invalid document path')
  let name = value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[a-z]:\\)/i, '')
  const windows = /^[a-z]:/i.test(name) || /^\\\\/.test(name)
  const parser = windows ? path.win32 : path.posix
  if (!parser.isAbsolute(name)) throw invalid('document path must be absolute')
  name = parser.normalize(name)
  return windows ? name.toLowerCase() : name
}
function json(value, limit = 900_000) {
  let nodes = 0
  const visit = (v, depth) => {
    if (++nodes > 100000 || depth > 32) throw invalid('payload structure too large')
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return
    if (typeof v === 'number' && Number.isFinite(v)) return
    if (!v || typeof v !== 'object') throw invalid('payload must contain JSON values')
    for (const key of Object.keys(v)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw invalid('unsafe object key'); visit(v[key], depth + 1) }
  }
  visit(value, 0)
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > limit) throw invalid('payload exceeds byte limit')
  return JSON.parse(text)
}
export function validateConversation(value) {
  object(value)
  const allowed = ['id','title','messages','draft','quote','modelSelection','mode','createdAt','updatedAt','parentId','forkMessageId','titleSource','titleBasis']
  if (Object.keys(value).some(key => !allowed.includes(key))) throw invalid('unknown conversation field')
  for (const key of allowed.slice(0, 9)) if (!Object.hasOwn(value, key)) throw invalid(`missing ${key}`)
  id(value.id)
  if (typeof value.title !== 'string' || value.title.length > 500 || typeof value.draft !== 'string' || value.draft.length > 20000) throw invalid('invalid title or draft')
  if (Object.hasOwn(value, 'titleSource') && value.titleSource !== 'model') throw invalid('invalid title source')
  if (Object.hasOwn(value, 'titleBasis') && (typeof value.titleBasis !== 'string' || value.titleBasis.length > 160)) throw invalid('invalid title basis')
  if (!Array.isArray(value.messages) || value.messages.length > 2000) throw invalid('invalid messages')
  for (const message of value.messages) object(message)
  if (value.quote !== null) object(value.quote)
  if (value.modelSelection !== null) {
    object(value.modelSelection)
    if (Object.keys(value.modelSelection).some(key => !['provider','model'].includes(key)) || !['provider','model'].every(key => typeof value.modelSelection[key] === 'string' && value.modelSelection[key].length > 0 && value.modelSelection[key].length <= 500)) throw invalid('invalid model selection')
  }
  if (!['learn','reread'].includes(value.mode)) throw invalid('invalid mode')
  for (const key of ['createdAt','updatedAt']) {
    const time = value[key]
    if (!(typeof time === 'number' && Number.isFinite(time) && time >= 0) && !(typeof time === 'string' && time.length <= 40 && Number.isFinite(Date.parse(time)))) throw invalid('invalid timestamp')
  }
  for (const key of ['parentId','forkMessageId']) if (value[key] != null) id(value[key])
  return json(value)
}
function serialized(key, task) {
  const result = (queues.get(key) ?? Promise.resolve()).then(task)
  const tail = result.catch(() => {})
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return result
}
export function createConversationStore({ directory } = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')) throw invalid('invalid directory')
  const root = path.resolve(directory)
  const target = documentPath => { const document = identity(documentPath); return { document, file: path.join(root, createHash('sha256').update(document).digest('hex') + '.json') } }
  async function load(item) {
    let text
    try { text = await readFile(item.file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return { conversations: [], activeId: null }; throw error }
    try {
      if (Buffer.byteLength(text) > 32_000_000) throw invalid('store exceeds byte limit')
      const data = JSON.parse(text)
      if (data.schemaVersion !== 1 || data.documentPath !== item.document || !Array.isArray(data.conversations) || data.conversations.length > 200) throw invalid('stored schema mismatch')
      const conversations = data.conversations.map(validateConversation)
      if (new Set(conversations.map(c => c.id)).size !== conversations.length || (data.activeId !== null && !conversations.some(c => c.id === data.activeId))) throw invalid('invalid stored activeId or duplicates')
      return { conversations, activeId: data.activeId }
    } catch (cause) { throw Object.assign(new Error('Saved conversations are corrupt; original data was preserved.', { cause }), { code: 'CONVERSATION_CORRUPT' }) }
  }
  return {
    async get(documentPath) { const item = target(documentPath); return serialized(item.file.toLowerCase(), () => load(item)) },
    async mutate(documentPath, input) {
      object(input)
      if (!['save','remove'].includes(input.action) || Object.keys(input).some(key => !['action','conversation','id','activeId'].includes(key))) throw invalid('invalid operation')
      const operation = json(input)
      if (operation.action === 'save') operation.conversation = validateConversation(operation.conversation)
      else id(operation.id)
      if (Object.hasOwn(operation, 'activeId') && operation.activeId !== null) id(operation.activeId)
      const item = target(documentPath)
      return serialized(item.file.toLowerCase(), async () => {
        const data = await load(item)
        if (operation.action === 'save') {
          const index = data.conversations.findIndex(c => c.id === operation.conversation.id)
          if (index < 0) data.conversations.push(operation.conversation)
          else data.conversations[index] = operation.conversation
        } else {
          data.conversations = data.conversations.filter(c => c.id !== operation.id)
          if (data.activeId === operation.id) data.activeId = null
        }
        if (Object.hasOwn(operation, 'activeId')) data.activeId = operation.activeId
        if (data.activeId !== null && !data.conversations.some(c => c.id === data.activeId)) throw invalid('activeId must reference a saved conversation')
        if (data.conversations.length > 200) throw invalid('conversation count exceeds 200')
        const text = JSON.stringify({ schemaVersion: 1, documentPath: item.document, ...data }) + '\n'
        if (Buffer.byteLength(text) > 32_000_000) throw invalid('store exceeds byte limit')
        await mkdir(root, { recursive: true })
        const temporary = item.file + '.' + randomUUID() + '.tmp'
        let handle
        try {
          handle = await open(temporary, 'wx', 0o600)
          await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = undefined
          for (let retry = 0; ; retry++) { try { await rename(temporary, item.file); break } catch (error) { if (!['EPERM','EACCES','EBUSY','EEXIST'].includes(error.code) || retry >= 5) throw error; await delay(10 * 2 ** retry) } }
        } finally { if (handle) await handle.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
        return structuredClone(data)
      })
    },
  }
}
