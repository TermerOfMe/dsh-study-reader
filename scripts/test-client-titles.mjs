import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const json = value => JSON.parse(JSON.stringify(value))
const helpers = source.slice(source.indexOf('    function settledMessages('), source.indexOf('    function contextQuery('))
function setup() {
  const context = { uid: () => 'id', Date }
  vm.createContext(context)
  vm.runInContext(helpers, context)
  return context
}
const messages = [
  { id: 'q1', role: 'user', text: 'Explain this', quote: 'Bayesian posterior' },
  { id: 'a1', role: 'assistant', text: 'The posterior combines prior and likelihood.' },
]
test('title basis ignores incomplete, failed and aborted answers', () => {
  const c = setup()
  assert.equal(c.conversationTitleBasis(messages), 'a1')
  assert.equal(c.conversationTitleBasis([...messages, { id: 'a2', role: 'assistant', text: 'partial', pending: true }]), '')
  assert.equal(c.conversationTitleBasis([...messages, { id: 'a2', role: 'assistant', text: 'partial', aborted: true }]), 'a1')
  assert.equal(c.conversationTitleBasis([{ id: 'a2', role: 'assistant', text: 'partial', error: 'failed' }]), '')
})
test('autosaving messages/drafts preserves generated model titles and legacy branch titles', () => {
  const c = setup()
  assert.equal(c.savedConversationTitle({ title: 'Posterior probability', titleSource: 'model' }, messages, 'Untitled'), 'Posterior probability')
  assert.equal(c.savedConversationTitle({ title: 'Branch', parentId: 'parent' }, messages, 'Untitled'), 'Branch')
  assert.equal(c.savedConversationTitle({ title: 'Untitled' }, messages, 'Untitled'), 'Explain this')
})
test('summary excerpts retain the opening topic, recent turns and quotes but exclude reasoning/images', () => {
  const c = setup()
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `turn ${i} ` + 'x'.repeat(3000), quote: 'q'.repeat(2000), reasoning: 'private reasoning', crop: { x: 1 } }))
  const result = json(c.conversationTitleMessages(many))
  assert.equal(result.length, 8)
  assert.ok(result[0].text.startsWith('turn 0 '))
  assert.ok(result[1].text.startsWith('turn 1 '))
  assert.ok(result[2].text.startsWith('turn 14 '))
  assert.ok(result[7].text.startsWith('turn 19 '))
  assert.ok(result.every(item => item.text.length <= 2500 && item.quote.length <= 1500 && Object.keys(item).sort().join() === 'quote,role,text'))
})
const start = source.indexOf('      // Summarize one conversation at a time')
const end = source.indexOf('      const retryTitles = useCallback', start)
const effectCode = source.slice(start, end).match(/useEffect\(\(\) => \{([\s\S]*?)\n      \}, \[/)[1]
function scheduler() {
  let timer, resolveRequest
  const item = { id: 'chat', title: 'Explain this', messages, modelSelection: null, draft: 'unsent' }
  const library = { path: '/doc.pdf', docId: 'doc', activeId: 'chat', conversations: [item] }
  const state = { saved: [], requests: [], error: '', status: '', revision: 0 }
  const c = setup()
  Object.assign(c, {
    libraryRef: { current: library }, doc: { path: library.path }, openingPath: null, busy: false, translationBusy: false,
    titleRequestRef: { current: null }, titleAttemptsRef: { current: new Set() }, lang: 'en', AbortController, AbortSignal,
    window: { setTimeout: fn => { timer = fn; return 1 }, clearTimeout() {} },
    setTitleStatus: value => { state.status = value }, setTitleError: value => { state.error = value },
    setTitleRevision: fn => { state.revision = fn(state.revision) }, t: key => key,
    apiPost: async (path, payload) => { state.requests.push({ path, payload }); return new Promise(resolve => { resolveRequest = resolve }) },
    commitConversation: (next, target) => { state.saved.push(next); target.conversations = target.conversations.map(old => old.id === next.id ? next : old) },
  })
  const run = () => vm.runInContext(`(() => {${effectCode}\n})()`, c)
  return { c, state, item, library, run, start: () => timer(), finish: async body => { resolveRequest({ json: async () => body }); await new Promise(resolve => setImmediate(resolve)) } }
}
test('summary merges latest draft and messages instead of replacing conversation snapshot', async () => {
  const s = scheduler(); s.run(); s.start()
  s.library.conversations[0] = { ...s.item, draft: 'new draft' }
  await s.finish({ ok: true, title: 'Bayesian posterior' })
  assert.equal(s.state.saved[0].draft, 'new draft')
  assert.equal(s.state.saved[0].titleSource, 'model')
  assert.equal(s.state.saved[0].titleBasis, 'a1')
  assert.equal(s.state.requests[0].payload.messages[0].quote, 'Bayesian posterior')
})
for (const kind of ['delete', 'switch-document', 'newer-answer', 'abort']) test(`late summary cannot overwrite ${kind}`, async () => {
  const s = scheduler(); s.run(); s.start()
  if (kind === 'delete') s.library.conversations = []
  if (kind === 'switch-document') s.c.libraryRef.current = { ...s.library }
  if (kind === 'newer-answer') s.library.conversations[0] = { ...s.item, messages: [...messages, { id: 'a2', role: 'assistant', text: 'new answer' }] }
  if (kind === 'abort') s.c.titleRequestRef.current.abort()
  await s.finish({ ok: true, title: 'Old title' })
  assert.equal(s.state.saved.length, 0)
})
test('failed summaries retain original title and do not loop until explicit retry', async () => {
  const s = scheduler(); s.run(); s.start()
  await s.finish({ ok: false, error: { message: 'Model unavailable' } })
  assert.equal(s.state.saved.length, 0)
  assert.equal(s.item.title, 'Explain this')
  assert.match(s.state.error, /Model unavailable/)
  assert.equal(s.run(), undefined)
  assert.equal(s.state.requests.length, 1)
})
test('aborting a title request releases its attempt key for later retry', async () => {
  const s = scheduler(); s.run(); s.start()
  assert.equal(s.c.titleAttemptsRef.current.size, 1)
  s.c.titleRequestRef.current.abort()
  await s.finish({ ok: true, title: 'Ignored' })
  assert.equal(s.c.titleAttemptsRef.current.size, 0)
})
test('a successful title does not hide another conversation summary failure', async () => {
  const s = scheduler(); s.state.error = 'A previous summary failed'; s.run(); s.start()
  await s.finish({ ok: true, title: 'Bayesian posterior' })
  assert.equal(s.state.error, 'A previous summary failed')
})
test('answer/translation activity and an in-flight title prevent another summary request', () => {
  for (const key of ['busy', 'translationBusy']) { const s = scheduler(); s.c[key] = true; assert.equal(s.run(), undefined); assert.equal(s.state.requests.length, 0) }
  const s = scheduler(); s.run(); s.start(); assert.equal(s.run(), undefined); s.c.titleRequestRef.current.abort()
})
