import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

// Evaluate the actual standalone policy, never a copy of its implementation.
// Anchoring the closing brace to the function's indentation excludes adjacent
// helpers and deliberately fails if the policy stops being independently pure.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const definitions = [...source.matchAll(/^([ \t]*)function keyboardCommand\(event, scope\) \{[\s\S]*?^\1\}/gm)]
assert.equal(definitions.length, 1, 'client.js must define exactly one extractable keyboardCommand(event, scope)')
const keyboardCommand = vm.runInNewContext(`(${definitions[0][0]})`, Object.create(null), {
  filename: 'client.js:keyboardCommand', timeout: 1000,
})
assert.equal(typeof keyboardCommand, 'function')

test('Ctrl+wheel cancels browser zoom and dispatches reader zoom; cleanup removes listener', () => {
  const definition = source.match(/^([ \t]*)function bindReaderWheel\(root, dispatch\) \{[\s\S]*?^\1\}/m)
  assert.ok(definition)
  const bind = vm.runInNewContext(`(${definition[0]})`)
  let handler
  const root = {
    addEventListener(name, listener, options) {
      assert.equal(name, 'wheel')
      assert.equal(options.passive, false)
      handler = listener
    },
    removeEventListener(name, listener) {
      assert.equal(name, 'wheel')
      assert.equal(listener, handler)
      handler = null
    },
  }
  const calls = []
  const unbind = bind(root, command => calls.push(command))
  const send = overrides => handler({
    ctrlKey: true, cancelable: true, deltaY: -120,
    preventDefault: () => calls.push('prevent'), ...overrides,
  })
  send({})
  send({ deltaY: 120 })
  assert.deepEqual(calls, ['prevent', 'zoom-in', 'prevent', 'zoom-out'])
  calls.length = 0
  for (const overrides of [
    { ctrlKey: false }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { deltaY: 0 }, { deltaY: NaN }, { defaultPrevented: true }, { cancelable: false },
  ]) send(overrides)
  assert.deepEqual(calls, [])
  unbind()
  assert.equal(handler, null)
})

test('explain keeps the selection while busy and submits its context when idle', () => {
  const definition = source.match(/const explainSelection = useCallback\(\(\) => \{([\s\S]*?)\n      \}, \[busy, doc, lang, selection, sendQuestion, showToast, t\]\)/)
  assert.ok(definition, 'extract the actual explain callback')
  const selection = { text: 'selected passage', blockId: 4, page: 1, pdfPage: 2, crop: { x: 0.1 } }
  for (const busy of [true, false]) {
    const calls = []
    const context = {
      busy, doc: {}, lang: 'en', selection,
      showToast: message => calls.push(['toast', message]),
      t: key => key,
      setSelection: value => calls.push(['selection', value]),
      sendQuestion: (question, quote) => calls.push(['question', question, quote]),
    }
    vm.runInNewContext(`(() => {${definition[1]}\n})()`, context)
    if (busy) assert.deepEqual(calls, [['toast', 'explainBusy']])
    else {
      assert.deepEqual(calls[0], ['selection', null])
      assert.equal(calls[1][0], 'question')
      assert.match(calls[1][1], /explain/)
      assert.deepEqual(JSON.parse(JSON.stringify(calls[1][2])), selection)
    }
  }
})

const event = (key, extra = {}) => Object.freeze({
  key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  defaultPrevented: false, isComposing: false, keyCode: 0, ...extra,
})
const command = (key, scope, extra) => keyboardCommand(event(key, extra), scope)
const scopes = ['reader', 'page', 'search']

function expectKeys(scope, pairs, extra) {
  for (const [key, expected] of pairs) {
    assert.equal(command(key, scope, extra), expected, `${scope}: ${key} ${JSON.stringify(extra ?? {})}`)
  }
}

test('reader arrows and WASD dispatch equivalent page/scroll directions', () => {
  expectKeys('reader', [
    ['ArrowLeft', 'previous-page'], ['a', 'previous-page'],
    ['ArrowRight', 'next-page'], ['d', 'next-page'],
    ['ArrowUp', 'scroll-up'], ['w', 'scroll-up'],
    ['ArrowDown', 'scroll-down'], ['s', 'scroll-down'],
  ])
})

test('search arrows and WASD dispatch equivalent previous/next results', () => {
  expectKeys('search', [
    ['ArrowLeft', 'previous-result'], ['a', 'previous-result'],
    ['ArrowUp', 'previous-result'], ['w', 'previous-result'],
    ['ArrowRight', 'next-result'], ['d', 'next-result'],
    ['ArrowDown', 'next-result'], ['s', 'next-result'],
  ])
})

test('Alt+A/D and Alt+Left/Right navigate reader history only', () => {
  const pairs = [['a', 'back'], ['ArrowLeft', 'back'], ['d', 'forward'], ['ArrowRight', 'forward']]
  expectKeys('reader', pairs, { altKey: true })
  for (const scope of ['page', 'search']) {
    expectKeys(scope, pairs.map(([key]) => [key, null]), { altKey: true })
  }
})

test('G and zoom controls are restricted to the reader', () => {
  const pairs = [['g', 'page-number'], ['+', 'zoom-in'], ['=', 'zoom-in'], ['-', 'zoom-out']]
  expectKeys('reader', pairs)
  assert.equal(command('+', 'reader', { shiftKey: true }), 'zoom-in', 'Shift-generated + remains usable')
  for (const scope of ['page', 'search']) {
    expectKeys(scope, pairs.map(([key]) => [key, null]))
    assert.equal(command('+', scope, { shiftKey: true }), null)
  }
})

test('page actions map F/O/Q/X/C/T/E/R to accepted commands', () => {
  expectKeys('page', [
    ['f', 'search'], ['o', 'toc'], ['q', 'ask'], ['x', 'new-chat'],
    ['t', 'translate'], ['c', 'explain'], ['e', 'highlight'], ['r', 'note'],
  ])
  expectKeys('reader', ['f', 'o', 'q', 'x', 'c', 't', 'e', 'r'].map(key => [key, null]))
})

test('F inside search edits the query rather than reopening search', () => {
  assert.equal(command('f', 'search'), 'search-input')
  expectKeys('search', ['o', 'q', 'x', 'c', 't', 'e', 'r', 'g'].map(key => [key, null]))
})

test('search Enter and Shift+Enter move next and previous', () => {
  assert.equal(command('Enter', 'search'), 'next-result')
  assert.equal(command('Enter', 'search', { shiftKey: true }), 'previous-result')
  for (const scope of ['reader', 'page']) {
    assert.equal(command('Enter', scope), null)
    assert.equal(command('Enter', scope, { shiftKey: true }), null)
  }
})

test('uppercase keys without Shift preserve all letter aliases and actions', () => {
  expectKeys('reader', [['W', 'scroll-up'], ['A', 'previous-page'], ['S', 'scroll-down'], ['D', 'next-page'], ['G', 'page-number']])
  expectKeys('search', [['W', 'previous-result'], ['A', 'previous-result'], ['S', 'next-result'], ['D', 'next-result'], ['F', 'search-input']])
  expectKeys('page', [['F', 'search'], ['O', 'toc'], ['Q', 'ask'], ['X', 'new-chat'], ['T', 'translate'], ['C', 'explain'], ['E', 'highlight'], ['R', 'note']])
  expectKeys('reader', [['A', 'back'], ['D', 'forward']], { altKey: true })
})

test('IME, nativeEvent composition, keyCode229 and handled events suppress every command', () => {
  const guards = [
    { isComposing: true },
    { nativeEvent: Object.freeze({ isComposing: true }) },
    { keyCode: 229 },
    { defaultPrevented: true },
  ]
  const keys = ['w', 'a', 's', 'd', 'g', '+', '-', 'f', 'o', 'q', 'x', 'c', 't', 'e', 'r', 'Enter', 'ArrowLeft']
  for (const scope of scopes) for (const guard of guards) for (const key of keys) {
    assert.equal(command(key, scope, guard), null, `${scope}: ${key} ${JSON.stringify(guard)}`)
    assert.equal(command(key, scope, { ...guard, altKey: true }), null)
    assert.equal(command(key, scope, { ...guard, shiftKey: true }), null)
  }
})

test('Ctrl and Meta combinations never dispatch reader shortcuts', () => {
  for (const scope of scopes) for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const key of ['w', 'a', 's', 'd', 'g', '+', '-', 'f', 'o', 'q', 'x', 'c', 't', 'e', 'r', 'Enter', 'ArrowLeft']) {
      for (const extra of [{}, { altKey: true }, { shiftKey: true }]) {
        assert.equal(command(key, scope, { ...extra, [modifier]: true }), null, `${scope}: ${modifier} ${key}`)
      }
    }
  }
})

test('unsupported Alt combinations and Alt+Shift are ignored', () => {
  for (const scope of scopes) {
    expectKeys(scope, ['w', 's', 'ArrowUp', 'ArrowDown', 'g', '+', '-', 'f', 'o', 'q', 'x', 'c', 't', 'e', 'r', 'Enter'].map(key => [key, null]), { altKey: true })
    expectKeys(scope, ['a', 'd', 'ArrowLeft', 'ArrowRight', '+', 'Enter'].map(key => [key, null]), { altKey: true, shiftKey: true })
  }
})

test('unsupported Shift combinations are ignored, including shifted equals/minus', () => {
  for (const scope of scopes) {
    expectKeys(scope, ['w', 'a', 's', 'd', 'g', 'f', 'o', 'q', 'x', 'c', 't', 'e', 'r', 'W', 'F', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '=', '-', '_'].map(key => [key, null]), { shiftKey: true })
  }
})

test('unassigned keys have no command and event objects remain untouched', () => {
  for (const scope of scopes) {
    expectKeys(scope, ['Escape', 'Tab', ' ', 'b', 'n', 'h', '/', '?', '0', 'PageDown', 'Unidentified', 'Process', 'Dead'].map(key => [key, null]))
  }
  const original = event('A', { nativeEvent: Object.freeze({ isComposing: false }) })
  const before = JSON.stringify(original)
  assert.equal(keyboardCommand(original, 'reader'), 'previous-page')
  assert.equal(JSON.stringify(original), before)
})
