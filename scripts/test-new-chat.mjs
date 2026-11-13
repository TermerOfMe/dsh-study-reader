import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const callback = name => {
  const match = source.match(new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\n      \\}, \\[`))
  assert.ok(match, `actual ${name} callback must be extractable`)
  return `(${match[1]}\n})`
}
function setup(selection = null, confirm = true) {
  const state = { messages: [{ id: 'old' }], busy: true, draft: 'old draft', quote: { text: 'old quote' }, focus: 0, aborted: 0, confirmations: 0, removed: [] }
  const context = {
    doc: { path: 'example.pdf' }, selection, messages: state.messages,
    askAbortRef: { current: { abort() { state.aborted++ } } },
    window: { confirm() { state.confirmations++; return confirm } },
    setMessages: value => { state.messages = value },
    setBusy: value => { state.busy = value },
    setQuestionDraft: value => { state.draft = value },
    setPendingQuote: value => { state.quote = value },
    setChatOpenPersisted: value => { state.open = value },
    setPanelTab: value => { state.tab = value },
    setSelection: value => { state.selection = value },
    setQuestionFocus: update => { state.focus = update(state.focus) },
    removeStore: key => state.removed.push(key), showToast() {}, t: key => key,
  }
  vm.createContext(context)
  context.askFromSelection = vm.runInContext(callback('askFromSelection'), context)
  return { state, context, clear: vm.runInContext(callback('clearChat'), context) }
}

test('X clears history, stale quote and draft, aborts generation and requests chat focus without confirmation', () => {
  const { state, context, clear } = setup()
  clear(true)
  assert.equal(state.messages.length, 0)
  assert.equal(state.draft, '')
  assert.equal(state.quote, null)
  assert.equal(state.aborted, 1)
  assert.equal(context.askAbortRef.current, null)
  assert.equal(state.busy, false)
  assert.equal(state.confirmations, 0)
  assert.equal(state.open, true)
  assert.equal(state.tab, 'chat')
  assert.equal(state.selection, null)
  assert.equal(state.focus, 1)
  assert.deepEqual(state.removed, ['chat:example.pdf'])
})

for (const [kind, selected] of [
  ['text', { text: 'selected passage', blockId: 12, page: 2, pdfPage: 3, crop: { x: .1, y: .2, width: .3, height: .1 } }],
  ['region', { text: '', blockId: 12, page: 2, pdfPage: 3, crop: { x: .1, y: .2, width: .3, height: .4 } }],
]) test(`X preserves ${kind} citation metadata while clearing history`, () => {
  const { state, clear } = setup(selected)
  clear(true)
  assert.equal(JSON.stringify(state.quote), JSON.stringify(selected))
  assert.equal(state.messages.length, 0)
  assert.equal(state.focus, 1)
})

test('new-thread button retains confirmation and cancelling leaves state intact', () => {
  const { state, clear } = setup(null, false)
  clear()
  assert.equal(state.confirmations, 1)
  assert.equal(state.messages.length, 1)
  assert.equal(state.draft, 'old draft')
  assert.equal(state.aborted, 0)
  assert.equal(state.focus, 0)
})

test('confirmed button shares reset, selected citation and focus behavior', () => {
  const { state, clear } = setup({ text: 'selected', blockId: 1, page: 0, pdfPage: 1 })
  clear()
  assert.equal(state.confirmations, 1)
  assert.equal(state.messages.length, 0)
  assert.equal(state.quote.text, 'selected')
  assert.equal(state.focus, 1)
})

test('no document means no reset', () => {
  const { state, context, clear } = setup()
  context.doc = null
  clear(true)
  assert.equal(state.messages.length, 1)
  assert.equal(state.aborted, 0)
})
