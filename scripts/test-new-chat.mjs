import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { validateConversation } from '../lib/conversations.js'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const callback = name => {
  const match = source.match(new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\n      \\}, \\[`))
  assert.ok(match, `actual ${name} callback must be extractable`)
  return `(${match[1]}\n})`
}
const json = value => JSON.parse(JSON.stringify(value))
function setup(selection = null, confirm = true) {
  let sequence = 0
  const state = { busy: false, focus: 0, aborted: 0, confirmations: 0, removed: [], writes: new Map(), saves: [], requests: [], messages: [], draft: '', quote: null }
  const context = {
    doc: { id: 'doc1', path: 'C:/example.pdf' }, selection, mode: 'learn', modelSelection: { provider: 'custom', model: 'pro' }, busy: false,
    uid: () => 'uid-' + ++sequence, t: key => key,
    Date, Map, Set, Promise, AbortController, AbortSignal, structuredClone,
    askAbortRef: { current: { abort() { state.aborted++ } } },
    libraryRef: { current: null }, liveChatRef: { current: null },
    dirtyConversationsRef: { current: new Map() }, saveQueueRef: { current: Promise.resolve() },
    window: { confirm() { state.confirmations++; return confirm }, setTimeout, clearTimeout,
      requestAnimationFrame() { return 1 }, cancelAnimationFrame() {} },
    setMessages: value => { state.messages = typeof value === 'function' ? value(state.messages) : value },
    setBusy: value => { state.busy = value }, setQuestionDraft: value => { state.draft = value },
    setPendingQuote: value => { state.quote = value }, setModelSelection: value => { state.model = value }, setMode: value => { state.mode = value },
    setConversations: value => { state.conversations = value }, setActiveConversationId: value => { state.activeId = value },
    setChatOpenPersisted: value => { state.open = value }, setPanelTab: value => { state.tab = value },
    setSelection: value => { state.selection = value }, setQuestionFocus: update => { state.focus = update(state.focus) },
    setSaveError: value => { state.error = value },
    writeStore: (key, value) => state.writes.set(key, json(value)), removeStore: key => state.removed.push(key), showToast() {},
    apiPost: async (path, body) => { state.saves.push(json(body)); return { json: async () => ({ ok: true }) } },
    positionBlock: 100, activePage: 9, appendReasoning: (before, chunk) => (before || '') + chunk,
    streamPost: async (path, body, signal, onFrame) => {
      state.requests.push(json(body)); onFrame({ type: 'delta', text: 'answer' }); onFrame({ type: 'done' })
    },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('    function settledMessages('), source.indexOf('    function contextQuery(')), context)
  for (const name of ['queueConversation', 'cacheLibrary', 'commitConversation', 'saveCurrentConversation', 'activateConversation', 'askFromSelection', 'sendQuestion', 'stopQuestion', 'clearChat', 'switchConversation', 'deleteConversation', 'forkChat', 'editQuestion', 'retrySave']) {
    context[name] = vm.runInContext(callback(name), context)
  }
  const original = context.newConversation(context.t, { id: 'original', messages: [
    { id: 'q1', role: 'user', text: 'first', blockId: 5, page: 2, mode: 'learn' },
    { id: 'a1', role: 'assistant', text: 'first answer', pending: false },
    { id: 'q2', role: 'user', text: 'second', blockId: 12, page: 3, pdfPage: 3, quote: 'selected', crop: { x: .1, y: .2, width: .3, height: .4 } },
    { id: 'a2', role: 'assistant', text: 'partial answer', pending: true },
  ], draft: 'saved draft', quote: { text: 'saved quote' }, modelSelection: context.modelSelection })
  const library = { path: context.doc.path, docId: 'doc1', conversations: [original], activeId: original.id, pendingIds: new Set(), deletedIds: new Set() }
  context.libraryRef.current = library
  state.messages = original.messages
  state.draft = original.draft
  state.quote = original.quote
  context.messages = state.messages
  context.liveChatRef.current = { messages: original.messages, draft: original.draft, quote: original.quote, modelSelection: original.modelSelection, mode: original.mode, activeId: original.id }
  return { state, context, library, original }
}

for (const [kind, selected] of [
  ['none', null],
  ['text', { text: 'selected passage', blockId: 12, page: 2, pdfPage: 3, crop: { x: .1, y: .2, width: .3, height: .1 } }],
  ['region', { text: '', blockId: 12, page: 2, pdfPage: 3, crop: { x: .1, y: .2, width: .3, height: .4 } }],
]) test(`X saves old conversation and focuses a new one with ${kind} selection`, async () => {
  const { state, context, library } = setup(selected)
  context.clearChat(true)
  await context.saveQueueRef.current
  assert.equal(library.conversations.length, 2)
  const old = library.conversations.find(item => item.id === 'original')
  assert.equal(old.messages.length, 4)
  assert.equal(old.messages[3].pending, false)
  assert.equal(old.messages[3].aborted, true)
  assert.equal(old.draft, 'saved draft')
  assert.equal(old.quote.text, 'saved quote')
  assert.equal(state.messages.length, 0)
  assert.equal(state.draft, '')
  assert.deepEqual(json(state.quote), selected)
  assert.equal(state.aborted, 1)
  assert.equal(state.confirmations, 0)
  assert.equal(state.open, true)
  assert.equal(state.tab, 'chat')
  assert.equal(state.selection, null)
  assert.equal(state.focus, 1)
  assert.ok(state.saves.every(item => item.action !== 'remove'))
  for (const item of state.saves) validateConversation(item.conversation)
})

test('new conversation button shares non-destructive behavior without confirmation', async () => {
  const { state, context, library } = setup(null, false)
  context.clearChat()
  await context.saveQueueRef.current
  assert.equal(state.confirmations, 0)
  assert.equal(library.conversations.length, 2)
})

test('no document means no new conversation', () => {
  const { state, context, library } = setup()
  context.doc = null
  context.clearChat()
  assert.equal(library.conversations.length, 1)
  assert.equal(state.aborted, 0)
})

test('switching restores messages, draft, quote and model; stops interrupted streams', async () => {
  const { state, context, library, original } = setup()
  const other = context.newConversation(context.t, { id: 'other', draft: 'other draft', quote: { text: 'other citation' }, mode: 'reread', modelSelection: { provider: 'other', model: 'm2' } })
  library.conversations.push(other)
  context.switchConversation('other')
  await context.saveQueueRef.current
  assert.equal(state.draft, 'other draft')
  assert.equal(state.quote.text, 'other citation')
  assert.deepEqual(json(state.model), { provider: 'other', model: 'm2' })
  assert.equal(state.mode, 'reread')
  assert.equal(state.aborted, 1)
  assert.equal(library.conversations.find(item => item.id === original.id).messages[3].aborted, true)
})

test('fork preserves the original, copies only the prefix and changes message ids', async () => {
  const { context, library, original } = setup()
  const before = json(original)
  context.forkChat('a1')
  await context.saveQueueRef.current
  const branch = library.conversations.find(item => item.id !== 'original')
  assert.equal(branch.parentId, 'original')
  assert.equal(branch.forkMessageId, 'a1')
  assert.equal(branch.messages.length, 2)
  assert.notEqual(branch.messages[0].id, 'q1')
  assert.deepEqual(json(original), before)
  assert.equal(branch.modelSelection.model, 'pro')
})

for (const branch of [false, true]) test(`editing ${branch ? 'in a branch' : 'in place'} sends edited question with original citation and prefix only`, async () => {
  const { state, context, library } = setup()
  context.editQuestion('q2', 'revised second question', branch)
  await context.saveQueueRef.current
  assert.equal(state.requests.length, 1)
  const request = state.requests[0]
  assert.equal(request.question, 'revised second question')
  assert.deepEqual(request.history.map(message => message.content), ['first', 'first answer'])
  assert.equal(request.blockId, 12)
  assert.equal(request.currentPage, 3)
  assert.equal(request.selection, 'selected')
  assert.deepEqual(request.selectionCrop, { x: .1, y: .2, width: .3, height: .4 })
  assert.equal(request.modelSelection.model, 'pro')
  assert.equal(library.conversations.length, branch ? 2 : 1)
  assert.deepEqual(json(state.messages).map(message => message.text), ['first', 'first answer', 'revised second question', 'answer'])
  if (branch) assert.equal(library.conversations.find(item => item.id === 'original').messages[2].text, 'second')
})

test('editing a question without quote preserves its original page and block', async () => {
  const { state, context } = setup()
  context.editQuestion('q1', 'revised first', false)
  await context.saveQueueRef.current
  assert.equal(state.requests[0].currentPage, 2)
  assert.equal(state.requests[0].blockId, 5)
  assert.equal(state.requests[0].history.length, 0)
})

test('deleting active conversation removes only it and creates an empty replacement', async () => {
  const { state, context, library } = setup()
  context.deleteConversation('original')
  await context.saveQueueRef.current
  assert.equal(library.conversations.length, 1)
  assert.notEqual(library.activeId, 'original')
  assert.equal(state.messages.length, 0)
  assert.equal(state.saves.filter(item => item.action === 'remove').length, 1)
  assert.equal(state.saves.find(item => item.action === 'remove').id, 'original')
})

test('cancelled deletion leaves conversation and running generation alone', () => {
  const { state, context, library } = setup(null, false)
  context.deleteConversation('original')
  assert.equal(library.conversations.length, 1)
  assert.equal(state.aborted, 0)
})

test('recovery uses only pending newer drafts, preserves unrelated Host history and applies deletion tombstones', () => {
  const { context } = setup()
  const result = context.restoreConversationBackup({ conversations: [
    { id: 'a', messages: [], draft: 'older', updatedAt: 1 },
    { id: 'b', messages: [], draft: 'host newer', updatedAt: 9 },
    { id: 'deleted', messages: [], updatedAt: 9 },
    { id: 'host-only', messages: [], updatedAt: 2 },
  ] }, { pendingIds: ['a','b','new'], deletedIds: ['deleted'], conversations: [
    { id: 'a', messages: [], draft: 'latest draft', updatedAt: 4 },
    { id: 'b', messages: [], draft: 'cache older', updatedAt: 3 },
    { id: 'new', messages: [], updatedAt: 4 },
    { id: 'stale', messages: [], updatedAt: 9 },
  ] })
  assert.deepEqual(json(result.conversations).map(item => item.id), ['a','b','host-only','new'])
  assert.equal(result.conversations[0].draft, 'latest draft')
  assert.equal(result.conversations[1].draft, 'host newer')
})

test('late cancelled frames cannot change a reopened conversation or clear a newer busy request', async () => {
  const { state, context, library } = setup()
  let frame, finish
  context.streamPost = (path, body, signal, onFrame) => { frame = onFrame; return new Promise(resolve => { finish = resolve }) }
  const request = context.sendQuestion('question')
  const old = context.askAbortRef.current
  old.abort()
  context.askAbortRef.current = new AbortController()
  state.busy = true
  const before = json(state.messages)
  frame({ type: 'delta', text: 'late text' })
  frame({ type: 'done' })
  finish()
  await request
  assert.deepEqual(json(state.messages), before)
  assert.equal(state.busy, true)
  assert.equal(library.activeId, 'original')
})

async function openHarness(saved, cached = null, legacy = []) {
  const { state, context } = setup()
  context.libraryRef.current = null
  context.openingRef = { current: null }
  context.readerControlsRef = { current: null }
  context.translationAbortRef = { current: null }
  context.docRef = { current: null }
  context.translationDocRef = { current: null }
  context.fetchReadingPosition = async () => null
  context.readStore = (key, fallback) => key.startsWith('conversations:') ? cached : key.startsWith('chat:') ? legacy : fallback
  context.apiGet = async () => saved
  context.rememberRecent = () => {}
  for (const name of ['setOpeningPath','setOpenError','setDoc','setActivePage','setPdfPageCount','setJumpRequest','setPositionBlock','setProgress','setBrowserOpen','setTocOpen','setTranslations','setChatOpen']) context[name] = value => { state[name] = value }
  const stored = new Map(saved.conversations.map(item => [item.id, item]))
  context.apiPost = async (path, body) => {
    if (path === '/open') return { json: async () => ({ ok: true, doc: { id: 'opened', path: 'C:/opened.pdf', name: 'opened.pdf', blocks: [{id:0}] } }) }
    state.saves.push(json(body))
    if (body.action === 'save') { validateConversation(json(body.conversation)); stored.set(body.conversation.id, json(body.conversation)) }
    else stored.delete(body.id)
    if (body.activeId && !stored.has(body.activeId)) throw new Error('active conversation was referenced before being saved')
    return { json: async () => ({ ok: true }) }
  }
  context.openPath = vm.runInContext(callback('openPath'), context)
  await context.openPath('C:/opened.pdf')
  await context.saveQueueRef.current
  return { state, context, stored }
}

test('opening saved history restores quote and draft without clearing them', async () => {
  const { original } = setup()
  const { state } = await openHarness({ conversations: [json(original)], activeId: original.id })
  assert.equal(state.quote.text, 'saved quote')
  assert.equal(state.draft, 'saved draft')
  assert.equal(state.setDoc.path, 'C:/opened.pdf')
  assert.equal(state.saves[0].conversation.quote.text, 'saved quote')
})

test('opening migrates legacy chat and saves every old message without the previous forty-message trim', async () => {
  const legacy = Array.from({length:64}, (_,index) => ({id:'m'+index,role:index%2?'assistant':'user',text:'message '+index}))
  const { state, stored } = await openHarness({ conversations: [], activeId: null }, null, legacy)
  assert.equal(state.messages.length, 64)
  assert.equal([...stored.values()][0].messages.length, 64)
  assert.ok(state.removed.includes('chat:C:/opened.pdf'))
})

test('opening recovers multiple pending threads with active thread saved before references and replays deletion', async () => {
  const { original } = setup()
  const first = {...json(original),id:'first',updatedAt:1}
  const active = {...json(original),id:'active',draft:'unsaved draft',updatedAt:4}
  const deleted = {...json(original),id:'deleted'}
  const { state, stored } = await openHarness({conversations:[deleted],activeId:'deleted'}, {conversations:[first,active],activeId:'active',pendingIds:['first','active'],deletedIds:['deleted']})
  assert.equal(state.activeId, 'active')
  assert.equal(state.draft, 'unsaved draft')
  assert.equal(stored.size,2)
  assert.ok(stored.has('first') && stored.has('active') && !stored.has('deleted'))
  assert.ok(!state.error)
})

test('retrying an old failed save preserves the currently selected conversation', async () => {
  const { state, context, library, original } = setup()
  const other=context.newConversation(context.t,{id:'other'})
  library.conversations.push(other)
  library.activeId='other'
  context.dirtyConversationsRef.current.set(library.path+'\0original',{docId:library.docId,path:library.path,payload:{action:'save',conversation:original,activeId:'original'}})
  context.retrySave()
  await context.saveQueueRef.current
  assert.equal(state.saves.at(-1).activeId,'other')
  assert.ok(state.saves.filter(item=>item.conversation.id==='original').every(item=>item.activeId===undefined))
})
