import assert from 'node:assert/strict'
import { createReadingSession, answerWithReading, estimateRequest, READING_TOOLS } from '../lib/reading.js'
import { streamCompletion } from '../lib/llm.js'
import { buildAskPrompt } from '../lib/context.js'

const doc = { title: 'Book', kind: 'pdf', extension: 'pdf', stats: { chars: 80 }, pages: Array.from({ length: 4 }, (_,i) => ({ label: `Page ${i+1}` })), toc: [{ title: 'Definition', page: 0, blockId: 0, level: 1 }], blocks: [
  { id: 0, page: 0, text: 'alpha definition', type: 'paragraph' }, { id: 1, page: 1, text: 'alpha example', type: 'paragraph' },
  { id: 2, page: 2, text: 'future secret alpha', type: 'paragraph' }, { id: 3, page: 3, text: 'Conclusion', type: 'paragraph' },
] }
const config = { adaptiveReading: true, readingMaxRounds: 3, readingMaxPages: 2, maxAnswerTokens: 4096, maxInputTokens: 24000, readingTotalTokens: 96000, temperature: 0.3 }
const traces = []
const session = createReadingSession({ doc, mode: 'learn', anchor: 1, currentPage: 2, config, vision: true, signal: new AbortController().signal,
  getImage: async () => { throw new Error('must not render forbidden image') }, onTrace: t => traces.push(t) })
const invoke = (name, args) => session.execute({ id: name, name, arguments: JSON.stringify(args) })
const search = await invoke('document_search', { query: 'alpha', offset: 0, reason: 'definition' })
assert(!search.text.includes('future secret'), 'search must not leak later blocks or neighbors')
const forbidden = await invoke('document_read', { pages: [3], format: 'text', offset: 0, crop: null })
assert(forbidden.isError)
const samePageImage = await invoke('document_read', { pages: [2], format: 'image', offset: 0, crop: null })
assert(samePageImage.isError)
const read = await invoke('document_read', { pages: [1], format: 'text', offset: 0, crop: null })
assert(read.text.includes('alpha definition'))
const repeated = await invoke('document_read', { pages: [1], format: 'text', offset: 0, crop: null })
assert(repeated.text.includes('已读取'))
assert.equal(session.seenPages.size, 1)
const malformed = await session.execute({ id: 'bad', name: 'document_read', arguments: '{' })
assert(malformed.isError)

let requests = [], number = 0
const callBlock = (id, name, args) => ({ type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } })
const responses = [
  [callBlock('t1', 'document_search', { query: 'alpha', offset: 0, reason: 'locate' }), { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } }, { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { signature: 'preserve' } } }],
  [callBlock('t2', 'document_read', { pages: [1], format: 'text', offset: 0, crop: null, reason: 'verify' }), { type: 'usage', usage: { inputTokens: 30, outputTokens: 5 } }, { type: 'finish', reason: { kind: 'tool-calls' } }],
  [{ type: 'text-delta', text: 'Answer [Page 1]' }, { type: 'usage', usage: { inputTokens: 40, outputTokens: 10 } }, { type: 'finish', reason: { kind: 'stop' } }],
]
const ctx = { get(name) {
  if (name === 'llm') return { resolveModelInfo: async () => ({ context: { contextWindow: 32768 } }), stream: opts => {
    requests.push(structuredClone(opts)); return (async function* () { for (const chunk of responses[number++]) yield chunk })()
  } }
  if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
} }
const audits = [], deltas = []
const s2 = createReadingSession({ doc, mode: 'reread', anchor: 1, currentPage: 2, config, vision: false })
const answer = await answerWithReading({ ctx, model: { provider: 'p', model: 'm' }, built: { system: 'System', prompt: 'Question' }, images: [], session: s2, config,
  onCall: audit => audits.push(audit), onDelta: t => deltas.push(t) })
assert.equal(answer.text, 'Answer [Page 1]')
assert.equal(answer.usage.inputTokens, 90)
assert.equal(answer.usage.outputTokens, 20)
assert.equal(requests.length, 3)
assert.equal(audits[0].messages.length, 1, 'first audit must not acquire future tool results')
assert.equal(audits[1].messages.length, 3)
assert.equal(audits[0].status, 'done')
assert.deepEqual(requests[1].messages[1].source.replayState, { response: { signature: 'preserve' } })
assert.equal(requests[1].messages[2].toolCallId, 't1')
assert.equal(deltas.join(''), 'Answer [Page 1]')
assert.equal(s2.traces.length, 2)
assert(estimateRequest(ctx, { provider: 'p', model: 'm' }, 'x', [{ role: 'user', content: [{ type: 'image', attachment: { width: 1200, height: 1600 } }] }], []) > 4096)

// Continuous tools are forced to stop after configured rounds, every call stays paired.
let rounds = 0
const alwaysTools = { get: name => name === 'llm' ? { resolveModelInfo: async () => ({}), stream: opts => (async function* () {
  rounds++
  if (opts.tools?.length) yield callBlock(`limit${rounds}`, 'document_outline', { offset: 0, reason: 'test' })
  else yield { type: 'text-delta', text: 'Bounded answer' }
  yield { type: 'finish', reason: { kind: opts.tools?.length ? 'tool-calls' : 'stop' } }
})() } : undefined }
const s3 = createReadingSession({ doc, mode: 'reread', anchor: 1, currentPage: 2, config, vision: false })
const bounded = await answerWithReading({ ctx: alwaysTools, model: { provider: 'p', model: 'm' }, built: { system: 's', prompt: 'q' }, images: [], session: s3, config: { ...config, readingMaxRounds: 1 } })
assert.equal(rounds, 2)
assert.equal(bounded.text, 'Bounded answer')

const abort = new AbortController(); abort.abort()
await assert.rejects(() => answerWithReading({ ctx, model: { provider: 'p', model: 'm' }, built: { system: 's', prompt: 'p' }, images: [], session: s2, config, signal: abort.signal }), /已停止/)
await assert.rejects(() => answerWithReading({ ctx, model: { provider: 'p', model: 'm' }, built: { system: 'x'.repeat(200000), prompt: 'p' }, images: [], session: s2, config }), /超过输入预算/)

// Retry usage aggregates rather than hiding the failed attempt.
let retry = 0
const retryCtx = { get: name => name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : { stream: () => (async function* () {
  retry++
  if (retry === 2) yield { type: 'text-delta', text: 'done' }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } }
  yield { type: 'finish', reason: { kind: retry === 1 ? 'max-tokens' : 'stop' } }
})() } }
const retried = await streamCompletion({ ctx: retryCtx, system: 's', prompt: 'p', maxTokens: 100 })
assert.equal(retried.usage.inputTokens, 20)
assert.equal(retried.usage.outputTokens, 40)
assert.equal(READING_TOOLS.length, 3)
// Page errors preserve successful images; admission remains transactional.
let renders = 0
const transactional = createReadingSession({ doc, mode: 'reread', anchor: 1, currentPage: 2, config, vision: true, getImage: async page => {
  renders++
  if (page === 2) throw new Error('render failed')
  return { ref: { attachmentId: 'image1', width: 100, height: 100 }, meta: { page } }
} })
const partialImages = await transactional.execute({ name: 'document_read', arguments: JSON.stringify({ pages: [1,2], format: 'image', offset: 0, crop: null }) })
assert(!partialImages.isError)
assert.equal(partialImages.images.length, 1)
assert.equal(JSON.parse(partialImages.text).pages[1].error, 'render failed')
assert.equal(transactional.images.length, 1)
assert.equal(transactional.seenPages.size, 1)
const crop = { x: 0, y: 0, width: .5, height: .5 }
const pendingRead = await transactional.execute({ name: 'document_read', arguments: JSON.stringify({ pages: [1], format: 'image', offset: 0, crop }) }, { deferCommit: true })
assert.equal(transactional.images.length, 1)
pendingRead.commit(false, 'over budget')
assert.equal(transactional.images.length, 1)
const retryRead = await transactional.execute({ name: 'document_read', arguments: JSON.stringify({ pages: [1], format: 'image', offset: 0, crop, reason: 'retry' }) })
assert.equal(retryRead.images.length, 1)
assert.equal(transactional.images.length, 2)
assert.equal(transactional.seenPages.size, 1)
assert.equal(renders, 4)

const longDoc = { ...doc, stats: { chars: 100000 }, blocks: Array.from({ length: 100 }, (_, i) => ({ id: i, page: i % 4, type: 'paragraph', text: `alpha ${i} ` + 'evidence '.repeat(110) })) }
const build = adaptiveReading => buildAskPrompt({ doc: longDoc, mode: 'reread', anchorId: 50, question: 'alpha definition?', history: [], options: { adaptiveReading } })
const baseline = build(false), adaptiveInitial = build(true)
const measure = (built, tools) => estimateRequest(ctx, { provider: 'p', model: 'm' }, built.system, [{ role: 'user', content: [{ type: 'text', text: built.prompt }] }], tools)
const beforeTokens = measure(baseline, []), afterTokens = measure(adaptiveInitial, READING_TOOLS)
assert(afterTokens < beforeTokens, 'initial context savings should include the new tool schema overhead')
console.log(`synthetic first-turn estimate including tools: ${beforeTokens} -> ${afterTokens} tokens (not provider billing)`)
console.log('ok: native tool continuation, replay, audit snapshots, aggregated usage, policy, cache, budgets and cancellation')
