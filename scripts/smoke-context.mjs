/**
 * Offline smoke checks for the context inspector plumbing (not shipped).
 *
 * Run with: node scripts/smoke-context.mjs
 */
import { ContextLog, estimateTokens } from '../lib/context-log.js'
import { buildAskPrompt } from '../lib/context.js'
import { streamCompletion } from '../lib/llm.js'

const failures = []
const expect = (condition, message) => {
  if (!condition) failures.push(message)
}

const log = new ContextLog({ maxDocs: 2, maxEntries: 2 })
const entry = log.record({
  docId: 'doc-1',
  docTitle: 'Book',
  kind: 'ask',
  mode: 'learn',
  provider: 'provider',
  model: 'model',
  system: 'system prompt',
  prompt: 'user prompt',
  images: [{ kind: 'crop', page: 9, width: 100, height: 50, bytes: 1000 }],
  notes: { contextChars: 12, historyChars: 4, trimmed: true, briefInjected: false },
})
expect(entry.id === 'c1', 'first record id should be c1')
expect(log.get('doc-1', 'c1') === entry, 'record should be retrievable')
log.finish(entry, { status: 'done', usage: { inputTokens: 10 }, reasoning: 'why' })
const view = log.publicEntry(entry)
expect(view.status === 'done', 'status should be done')
expect(view.reasoning === 'why', 'reasoning should be recorded')
expect(view.stats.totalChars === 'system prompt'.length + 'user prompt'.length, 'char stats should add up')
expect(view.stats.estimatedTokens > 0, 'token estimate should be positive')
expect(view.images.length === 1 && view.images[0].kind === 'crop', 'image descriptor should survive')
log.record({ docId: 'doc-1', system: 's', prompt: 'p' })
log.record({ docId: 'doc-1', system: 's', prompt: 'p' })
expect(log.list('doc-1').length === 2, 'per-document ring should cap entries')
log.record({ docId: 'doc-2', system: 's', prompt: 'p' })
log.record({ docId: 'doc-3', system: 's', prompt: 'p' })
expect(log.get('doc-1', 'c1') === undefined, 'oldest document should be evicted')

expect(estimateTokens('') === 0, 'empty text has no tokens')
expect(estimateTokens('abcd') === 1, 'four Latin characters cost about one token')
expect(estimateTokens('中文') === 2, 'CJK characters cost about one token each')

const doc = {
  title: 'Sample',
  kind: 'pdf',
  kindLabel: 'PDF',
  pages: [{ label: '第 1 页' }, { label: '第 2 页' }],
  blocks: [
    { id: 0, page: 0, type: 'heading', text: 'Chapter' },
    { id: 1, page: 0, type: 'paragraph', text: 'Hello world.' },
    { id: 2, page: 1, type: 'paragraph', text: 'More text.' },
  ],
  toc: [{ title: 'Chapter', level: 1, page: 0, blockId: 0 }],
  stats: { chars: 20 },
}
const built = buildAskPrompt({
  doc,
  mode: 'learn',
  anchorId: 1,
  question: 'What is hello?',
  selection: 'Hello world.',
  history: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Earlier answer' }],
  options: {},
})
expect(built.stats.contextChars > 0, 'ask prompt should report context size')
expect(built.stats.historyChars > 0, 'ask prompt should report history size')
expect(built.prompt.includes('What is hello?'), 'question should be in the prompt')

function fakeCtx(streams) {
  let call = 0
  return {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      if (name === 'llm') {
        return {
          stream() {
            const chunks = streams[Math.min(call, streams.length - 1)]
            call += 1
            return (async function* () {
              for (const chunk of chunks) yield chunk
            })()
          },
        }
      }
      return undefined
    },
  }
}

const seen = []
const result = await streamCompletion({
  ctx: fakeCtx([[
    { type: 'reasoning-delta', text: 'think ' },
    { type: 'reasoning-delta', text: 'more' },
    { type: 'text-delta', text: 'answer' },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, reasoningTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]]),
  system: 's',
  prompt: 'p',
  maxTokens: 100,
  onReasoning: text => seen.push(text),
})
expect(result.text === 'answer', 'text should stream normally')
expect(result.reasoning === 'think more', 'reasoning should be collected')
expect(seen.join('') === 'think more', 'reasoning callback should fire')

const retried = await streamCompletion({
  ctx: fakeCtx([
    [
      { type: 'reasoning-delta', text: 'first ' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ],
    [
      { type: 'reasoning-delta', text: 'second' },
      { type: 'text-delta', text: 'done' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ]),
  system: 's',
  prompt: 'p',
  maxTokens: 4096,
})
expect(retried.text === 'done', 'empty max-tokens answer should retry')
expect(retried.reasoning === 'first second', 'both attempts reasoning should be kept')

const blockOnly = await streamCompletion({
  ctx: fakeCtx([[
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'complete thought' } },
    { type: 'text-delta', text: 'answer' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]]),
  system: 's',
  prompt: 'p',
  maxTokens: 100,
})
expect(blockOnly.reasoning === 'complete thought', 'a complete reasoning block should be captured too')

if (failures.length > 0) {
  console.error('smoke failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('ok: context log, prompt stats and reasoning capture behave as expected')
