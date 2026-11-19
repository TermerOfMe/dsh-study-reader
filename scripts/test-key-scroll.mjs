import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const definition = source.match(/^([ \t]*)function createReaderKeyScroll\(root, environment = window\) \{[\s\S]*?^\1\}/m)
assert.ok(definition, 'extract the actual keyboard scrolling controller')
const create = vm.runInNewContext(`(${definition[0]})`, { isKeyboardInput: target => target?.input === true })

function fixture() {
  let now = 0
  let nextId = 0
  const frames = new Map()
  const listeners = new Map()
  const docListeners = new Map()
  const add = store => (name, fn) => {
    if (!store.has(name)) store.set(name, new Set())
    store.get(name).add(fn)
  }
  const remove = store => (name, fn) => store.get(name)?.delete(fn)
  const emitTo = (store, name, event = {}) => { for (const fn of store.get(name) ?? []) fn(event) }
  const original = {}
  const owner = { dialog: false, querySelector: () => owner.dialog ? {} : null }
  const focus = { closest: selector => selector === '.dsr-original' ? original : owner }
  const calls = []
  const root = {
    isConnected: true,
    getClientRects: () => [1],
    closest: selector => selector === '.dsr-original' ? original : owner,
    scrollBy: options => calls.push(options.top),
  }
  const document = { activeElement: focus, hidden: false, addEventListener: add(docListeners), removeEventListener: remove(docListeners) }
  const environment = {
    document, performance: { now: () => now },
    requestAnimationFrame: fn => { const id = ++nextId; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: add(listeners), removeEventListener: remove(listeners),
  }
  const controller = create(root, environment)
  return {
    controller, root, document, owner, focus, calls, frames,
    total: () => calls.reduce((a, b) => a + b, 0),
    emit: (name, event) => emitTo(listeners, name, event),
    emitDoc: (name, event) => emitTo(docListeners, name, event),
    step(ms = 1000 / 60) {
      now += ms
      const current = [...frames.values()]
      frames.clear()
      for (const fn of current) fn(now)
    },
    listenerCount: () => [...listeners.values(), ...docListeners.values()].reduce((n, list) => n + list.size, 0),
  }
}

test('held movement is continuous and approximately independent of display frame rate', () => {
  const distance = hz => {
    const f = fixture()
    f.controller.start('KeyS', 1)
    for (let i = 0; i < hz; i++) f.step(1000 / hz)
    const result = f.total()
    f.controller.destroy()
    return result
  }
  const a = distance(60)
  const b = distance(120)
  assert.ok(a > 700 && a < 1000)
  assert.ok(Math.abs(a - b) < 10, `${a} versus ${b}`)
})

test('OS repeat events and repeated starts do not stack frames or speed', () => {
  const a = fixture()
  const b = fixture()
  a.controller.start('KeyS', 1)
  b.controller.start('KeyS', 1)
  for (let i = 0; i < 60; i++) {
    a.controller.start('KeyS', 1, true)
    a.controller.start('KeyS', 1)
    assert.equal(a.frames.size, 1)
    a.step()
    b.step()
  }
  assert.equal(a.total(), b.total())
  a.controller.destroy()
  b.controller.destroy()
})

test('matching release stops immediately; unrelated release leaves velocity intact', () => {
  const a = fixture()
  const b = fixture()
  for (const f of [a, b]) { f.controller.start('KeyS', 1); for (let i = 0; i < 10; i++) f.step() }
  a.emit('keyup', { code: 'KeyC' })
  a.step(); b.step()
  assert.equal(a.total(), b.total())
  a.emit('keyup', { code: 'KeyS' })
  const before = a.total()
  a.step()
  assert.equal(a.total(), before)
  assert.equal(a.frames.size, 0)
  a.controller.destroy(); b.controller.destroy()
})

test('latest held direction wins and releasing it resumes the prior direction', () => {
  const f = fixture()
  f.controller.start('KeyS', 1)
  for (let i = 0; i < 10; i++) f.step()
  f.controller.start('KeyW', -1)
  f.step()
  assert.ok(f.calls.at(-1) < 0)
  f.emit('keyup', { code: 'KeyW' })
  f.step()
  assert.ok(f.calls.at(-1) > 0)
  f.emit('keyup', { code: 'KeyS' })
  assert.equal(f.frames.size, 0)
  f.controller.destroy()
})

test('focus loss, hidden document, dialogs and disconnected reader stop motion', () => {
  for (const change of [
    f => { f.document.activeElement = null; f.emitDoc('focusin') },
    f => { f.document.activeElement = { input: true, closest: f.focus.closest }; f.emitDoc('focusin') },
    f => { f.document.hidden = true; f.emitDoc('visibilitychange') },
    f => { f.owner.dialog = true },
    f => { f.root.isConnected = false },
    f => { f.root.getClientRects = () => [] },
    f => { f.emit('blur') },
    f => { f.emit('keydown', { ctrlKey: true }) },
    f => { f.emitDoc('pointerdown') },
    f => { f.emitDoc('wheel') },
  ]) {
    const f = fixture()
    f.controller.start('KeyS', 1)
    f.step()
    change(f)
    const before = f.total()
    f.step()
    assert.equal(f.total(), before)
    assert.equal(f.frames.size, 0)
    f.controller.destroy()
  }
})

test('destroy removes all listeners and cancels the animation', () => {
  const f = fixture()
  assert.ok(f.listenerCount() >= 7)
  f.controller.start('KeyS', 1)
  f.controller.destroy()
  assert.equal(f.frames.size, 0)
  assert.equal(f.listenerCount(), 0)
})

test('a short tap before the first animation frame still moves the page', () => {
  const f = fixture()
  f.controller.start('KeyS', 1)
  f.emit('keyup', { code: 'KeyS' })
  assert.ok(f.total() > 0, 'short taps must remain useful')
  assert.equal(f.frames.size, 0)
  f.controller.destroy()
})
