/**
 * In-memory record of what the reader actually sent to the model.
 *
 * The reader is a study surface, not a Session, so its prompts never appear in
 * the conversation log. The Q&A panel therefore keeps the last few exact
 * requests per document: the system prompt, the user message (including the
 * document context), the ordered image attachments and the model metadata.
 * Answers link to their record by id, and the browser fetches it on demand.
 *
 * Nothing here is written to disk. Records die with the Host process (or when
 * the cache is evicted), which the UI reports as an expired context.
 */

const MAX_ENTRY_CHARS = 1_000_000
const MAX_REASONING_CHARS = 200_000

function cap(text, limit) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n…（记录已截断）`
}

/** Rough token estimate: CJK characters cost about one token, other text a quarter. */
export function estimateTokens(text) {
  const value = typeof text === 'string' ? text : ''
  if (value === '') return 0
  let cjk = 0
  for (const character of value) {
    if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(character)) cjk += 1
  }
  return Math.ceil(cjk + (value.length - cjk) / 4)
}

export class ContextLog {
  constructor({ maxDocs = 8, maxEntries = 12 } = {}) {
    this.maxDocs = Math.max(1, maxDocs)
    this.maxEntries = Math.max(1, maxEntries)
    this.byDoc = new Map()
    this.nextId = 1
  }

  /**
   * Record one request before it is dispatched. The returned entry is mutable
   * and is completed by finish() when the stream settles.
   */
  record(input) {
    const docId = typeof input.docId === 'string' ? input.docId : ''
    if (docId === '') throw new Error('context record needs a document id')
    const entry = {
      id: `c${this.nextId}`,
      at: Date.now(),
      docId,
      docTitle: typeof input.docTitle === 'string' ? input.docTitle : '',
      kind: input.kind === 'translate' ? 'translate' : 'ask',
      mode: typeof input.mode === 'string' ? input.mode : '',
      provider: typeof input.provider === 'string' ? input.provider : '',
      model: typeof input.model === 'string' ? input.model : '',
      system: cap(input.system, MAX_ENTRY_CHARS),
      prompt: cap(input.prompt, MAX_ENTRY_CHARS),
      images: (Array.isArray(input.images) ? input.images : []).map((image, index) => ({
        index,
        kind: image.kind === 'crop' ? 'crop' : 'page',
        page: Number(image.page) || 0,
        width: Number(image.width) || 0,
        height: Number(image.height) || 0,
        bytes: Number(image.bytes) || 0,
        renderWidth: Number(image.renderWidth) || 0,
        crop: image.crop !== null && typeof image.crop === 'object'
          ? {
            x: Number(image.crop.x) || 0,
            y: Number(image.crop.y) || 0,
            width: Number(image.crop.width) || 0,
            height: Number(image.crop.height) || 0,
          }
          : undefined,
        current: image.current === true,
      })),
      notes: input.notes !== null && typeof input.notes === 'object' ? input.notes : {},
      reasoning: '',
      usage: undefined,
      error: '',
      status: 'streaming',
      durationMs: 0,
      finished: false,
    }
    this.nextId += 1
    this.put(entry)
    return entry
  }

  put(entry) {
    let list = this.byDoc.get(entry.docId)
    if (list === undefined) {
      if (this.byDoc.size >= this.maxDocs) {
        const oldest = this.byDoc.keys().next().value
        this.byDoc.delete(oldest)
      }
      list = []
      this.byDoc.set(entry.docId, list)
    }
    list.push(entry)
    while (list.length > this.maxEntries) list.shift()
  }

  finish(entry, { status, usage, reasoning, error } = {}) {
    if (entry === null || entry === undefined || entry.finished === true) return entry
    entry.finished = true
    entry.status = status === 'error' || status === 'aborted' ? status : 'done'
    entry.durationMs = Math.max(0, Date.now() - entry.at)
    if (usage !== null && typeof usage === 'object') entry.usage = usage
    if (typeof reasoning === 'string' && reasoning !== '') entry.reasoning = cap(reasoning, MAX_REASONING_CHARS)
    if (typeof error === 'string' && error !== '') entry.error = error
    return entry
  }

  get(docId, id) {
    if (typeof docId !== 'string' || typeof id !== 'string') return undefined
    const list = this.byDoc.get(docId)
    if (list === undefined) return undefined
    return list.find(entry => entry.id === id)
  }

  list(docId) {
    const list = this.byDoc.get(docId) ?? []
    return list.map(entry => this.publicEntry(entry)).reverse()
  }

  publicEntry(entry) {
    if (entry === null || entry === undefined) return undefined
    const system = entry.system ?? ''
    const prompt = entry.prompt ?? ''
    const notes = entry.notes ?? {}
    return {
      id: entry.id,
      at: entry.at,
      kind: entry.kind,
      mode: entry.mode,
      provider: entry.provider,
      model: entry.model,
      system,
      prompt,
      images: entry.images.map(image => ({ ...image })),
      notes: { ...notes },
      reasoning: entry.reasoning ?? '',
      usage: entry.usage,
      status: entry.status,
      error: entry.error,
      durationMs: entry.durationMs,
      stats: {
        systemChars: system.length,
        promptChars: prompt.length,
        totalChars: system.length + prompt.length,
        contextChars: Number(notes.contextChars) || 0,
        estimatedTokens: estimateTokens(`${system}\n${prompt}`),
      },
    }
  }

  clear() {
    this.byDoc.clear()
  }
}
