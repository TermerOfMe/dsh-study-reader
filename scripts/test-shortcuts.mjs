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

test('page actions map F/O/Q/X/T/E/R to accepted commands', () => {
  expectKeys('page', [
    ['f', 'search'], ['o', 'toc'], ['q', 'ask'], ['x', 'new-chat'],
    ['t', 'translate'], ['e', 'highlight'], ['r', 'note'],
  ])
  expectKeys('reader', ['f', 'o', 'q', 'x', 't', 'e', 'r'].map(key => [key, null]))
})

test('F inside search edits the query rather than reopening search', () => {
  assert.equal(command('f', 'search'), 'search-input')
  expectKeys('search', ['o', 'q', 'x', 't', 'e', 'r', 'g'].map(key => [key, null]))
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
  expectKeys('page', [['F', 'search'], ['O', 'toc'], ['Q', 'ask'], ['X', 'new-chat'], ['T', 'translate'], ['E', 'highlight'], ['R', 'note']])
  expectKeys('reader', [['A', 'back'], ['D', 'forward']], { altKey: true })
})

test('IME, nativeEvent composition, keyCode229 and handled events suppress every command', () => {
  const guards = [
    { isComposing: true },
    { nativeEvent: Object.freeze({ isComposing: true }) },
    { keyCode: 229 },
    { defaultPrevented: true },
  ]
  const keys = ['w', 'a', 's', 'd', 'g', '+', '-', 'f', 'o', 'q', 'x', 't', 'e', 'r', 'Enter', 'ArrowLeft']
  for (const scope of scopes) for (const guard of guards) for (const key of keys) {
    assert.equal(command(key, scope, guard), null, `${scope}: ${key} ${JSON.stringify(guard)}`)
    assert.equal(command(key, scope, { ...guard, altKey: true }), null)
    assert.equal(command(key, scope, { ...guard, shiftKey: true }), null)
  }
})

test('Ctrl and Meta combinations never dispatch reader shortcuts', () => {
  for (const scope of scopes) for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const key of ['w', 'a', 's', 'd', 'g', '+', '-', 'f', 'o', 'q', 'x', 't', 'e', 'r', 'Enter', 'ArrowLeft']) {
      for (const extra of [{}, { altKey: true }, { shiftKey: true }]) {
        assert.equal(command(key, scope, { ...extra, [modifier]: true }), null, `${scope}: ${modifier} ${key}`)
      }
    }
  }
})

test('unsupported Alt combinations and Alt+Shift are ignored', () => {
  for (const scope of scopes) {
    expectKeys(scope, ['w', 's', 'ArrowUp', 'ArrowDown', 'g', '+', '-', 'f', 'o', 'q', 'x', 't', 'e', 'r', 'Enter'].map(key => [key, null]), { altKey: true })
    expectKeys(scope, ['a', 'd', 'ArrowLeft', 'ArrowRight', '+', 'Enter'].map(key => [key, null]), { altKey: true, shiftKey: true })
  }
})

test('unsupported Shift combinations are ignored, including shifted equals/minus', () => {
  for (const scope of scopes) {
    expectKeys(scope, ['w', 'a', 's', 'd', 'g', 'f', 'o', 'q', 'x', 't', 'e', 'r', 'W', 'F', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '=', '-', '_'].map(key => [key, null]), { shiftKey: true })
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
