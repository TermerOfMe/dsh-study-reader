import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const names = ['readStore', 'writeStore', 'readingPath', 'readingPosition', 'loadReadingPosition', 'saveReadingPosition', 'captureReadingPosition', 'readingPositionWriter', 'restoreReadingPosition', 'fetchReadingPosition', 'persistReadingPosition']
const functions = names.map(name => {
  const matches = [...source.matchAll(new RegExp(`^([ \\t]*)(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\1\\}`, 'gm'))]
  assert.equal(matches.length, 1, `${name} is the actual client function`)
  return matches[0][0]
}).join('\n')

function harness() {
  let now = 0, next = 1
  const tasks = new Map(), storage = new Map(), observers = []
  const warnings = [], requests = []
  const schedule = (fn, delay = 0) => { const id = next++; tasks.set(id, { fn, at: now + delay }); return id }
  const clock = amount => {
    const until = now + amount
    for (let count = 0; count < 1000; count++) {
      const first = [...tasks].filter(([, task]) => task.at <= until).sort((a,b) => a[1].at-b[1].at)[0]
      if (!first) { now = until; return }
      const [id, task] = first; tasks.delete(id); now = task.at; task.fn()
    }
    throw Error('unbounded timer work')
  }
  class Observer {
    constructor(fn) { this.fn = fn; this.active = true; observers.push(this) }
    observe() {}
    disconnect() { this.active = false }
  }
  const state = { host: { ok: true, position: null }, failStorage: false, failFetch: false }
  const context = {
    STORE_PREFIX: 'test.', APP_BASE: '/api/dsh-study', readingWriterId: 'test-writer', readingRevision: 0, readingPendingWrites: new Map(),
    localStorage: {
      getItem: key => { if (state.failStorage) throw Error('denied'); return storage.get(key) ?? null },
      setItem: (key,value) => { if (state.failStorage) throw Error('quota'); storage.set(key,value) },
      removeItem: key => storage.delete(key),
    },
    setTimeout: schedule, clearTimeout: id => tasks.delete(id),
    requestAnimationFrame: fn => schedule(fn, 16), cancelAnimationFrame: id => tasks.delete(id),
    ResizeObserver: Observer, MutationObserver: Observer,
    apiGet: async () => { requests.push({get:true}); if (state.failFetch) throw Error('offline'); return state.host },
    fetch: async (url, options) => { requests.push({url,options}); if (state.fetchImplementation) return state.fetchImplementation(url,options); if (state.failFetch) throw Error('offline'); return { ok: true, json: async () => state.host } },
  }
  const api = vm.runInNewContext(functions + '\n({' + names.join(',') + '})', context)
  return { ...api, state, storage, clock, tasks, warnings, requests, notify: () => observers.filter(o=>o.active).forEach(o=>o.fn()) }
}
const plain = value => JSON.parse(JSON.stringify(value))
const position = (pageNumber = 7, x = .2, y = .45) => ({ version: 1, pageNumber, x, y })

function pageDom() {
  let ready = false, pageTop = 500, pageWidth = 600, pageHeight = 900
  const listeners = new Map(), scrolled = []
  const root = {
    scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    scrollTo({top,left}) { this.scrollTop = top; this.scrollLeft = left; scrolled.push({top,left}) },
    querySelector(selector) { return selector.startsWith('.dsr-pdf-page[') ? page : {} },
  }
  const page = {
    getBoundingClientRect: () => ({top: pageTop-root.scrollTop, left: 16-root.scrollLeft, width: pageWidth, height: pageHeight}),
    querySelector: () => ready ? {} : null,
  }
  return { root, scrolled, listeners, ready: () => { ready = true }, shift: delta => { pageTop += delta }, resize: width => { pageWidth = width }, height: height => { pageHeight = height } }
}

test('stable source path handles Windows aliases and keeps POSIX case distinct', () => {
  const api = harness()
  assert.equal(api.readingPath('C:\\Books\\sub\\..\\My.pdf'), 'c:/books/my.pdf')
  assert.equal(api.readingPath('c:/Books/./My.pdf'), 'c:/books/my.pdf')
  assert.equal(api.readingPath('\\\\?\\C:\\Books\\My.pdf'), 'c:/books/my.pdf')
  assert.equal(api.readingPath('\\\\?\\UNC\\server\\share\\My.pdf'), '//server/share/my.pdf')
  assert.notEqual(api.readingPath('/Books/My.pdf'), api.readingPath('/Books/my.pdf'))
  assert.equal(api.readingPath(null), '')
  assert.equal(api.readingPath('bad\0path'), '')
})

test('positions validate records and clamp fractions and changed file page counts', () => {
  const api = harness()
  for (const record of [null, [], {}, {version:2,pageNumber:2}, position(0), position(1.5), position(Infinity), position('7')]) assert.equal(api.readingPosition(record), null)
  assert.deepEqual(plain(api.readingPosition(position(999, -5, 90), 12)), position(12, 0, 1))
  assert.deepEqual(plain(api.readingPosition(position(7, NaN, Infinity))), position(7, 0, 0))
  assert.equal(api.readingPosition(position(), 0), null)
})

test('source records isolate same-name documents and survive version/id changes', () => {
  const api = harness()
  api.saveReadingPosition('C:/books/a.pdf', position(23))
  api.saveReadingPosition('C:/other/a.pdf', position(4))
  assert.equal(api.loadReadingPosition('c:\\books\\a.pdf').pageNumber, 23)
  assert.equal(api.loadReadingPosition('C:/other/a.pdf').pageNumber, 4)
  assert.equal(api.loadReadingPosition('C:/missing/a.pdf'), null)
  api.saveReadingPosition('C:/books/a.pdf', position(24))
  assert.equal(JSON.parse(api.storage.get('test.readingPositions')).length, 2)
})

test('browser backup caps at 100 documents and tolerates corruption, quota and private mode', () => {
  const api = harness()
  for (let i=0;i<110;i++) api.saveReadingPosition('C:/books/'+i+'.pdf', position(i+1))
  assert.equal(JSON.parse(api.storage.get('test.readingPositions')).length, 100)
  assert.equal(api.loadReadingPosition('C:/books/0.pdf'), null)
  api.storage.set('test.readingPositions', '{broken')
  assert.equal(api.loadReadingPosition('C:/books/1.pdf'), null)
  api.state.failStorage = true
  assert.doesNotThrow(() => api.saveReadingPosition('C:/book.pdf', position()))
  assert.equal(api.loadReadingPosition('C:/book.pdf'), null)
})

test('debounced writer caches latest coordinates immediately and flushes on teardown', () => {
  const api = harness(), saves = []
  const writer = api.readingPositionWriter(p => saves.push(plain(p)))
  writer.flush() // Initial load must never write an invented page one.
  assert.deepEqual(saves, [])
  writer.record(position(7)); api.clock(100); writer.record(position(8)); api.clock(100)
  assert.deepEqual(saves, [])
  writer.flush()
  assert.deepEqual(saves, [position(8)])
  api.clock(1000); assert.equal(saves.length, 1)
  writer.record(position(9)); api.clock(180)
  assert.deepEqual(saves.at(-1), position(9))
})

test('capture uses relative page coordinates and ignores detached or zero-size pages', () => {
  const api = harness(), dom = pageDom()
  dom.root.scrollTop = 500 - 16 + .45 * 900
  dom.root.scrollLeft = .2 * 600
  assert.deepEqual(plain(api.captureReadingPosition(dom.root, 7)), position())
  assert.equal(api.captureReadingPosition(null,7), null)
  dom.resize(0)
  assert.equal(api.captureReadingPosition(dom.root,7), null)
})

test('single-page restore waits for real text readiness and scaled geometry', () => {
  const api = harness(), dom = pageDom(), done = []
  api.restoreReadingPosition(dom.root, position(), 600, value=>done.push(value))
  api.clock(16); assert.equal(dom.scrolled.length,0)
  dom.ready(); dom.resize(500); api.notify(); api.clock(16)
  assert.equal(dom.scrolled.length,0)
  dom.resize(600); api.notify(); api.clock(16)
  assert.deepEqual(dom.scrolled.at(-1), {top:889,left:120})
  assert.deepEqual(done, [])
  api.clock(1000); assert.deepEqual(done,[true])
  assert.equal(dom.listeners.size,0)
})

test('continuous restore corrects delayed preceding-page height and then stops on input', () => {
  const api = harness(), dom = pageDom(), done = []
  dom.ready()
  api.restoreReadingPosition(dom.root, position(), 600, value=>done.push(value))
  api.clock(16)
  dom.shift(230); api.notify(); api.clock(16)
  assert.equal(dom.root.scrollTop,1119)
  dom.listeners.get('wheel')()
  assert.deepEqual(done,[true])
  dom.shift(200); api.notify(); api.clock(5000)
  assert.equal(dom.root.scrollTop,1119)
})

test('restoration cancels cleanly on switch/unmount without overwriting pending record', () => {
  const api = harness(), dom = pageDom(), done = []
  const cleanup = api.restoreReadingPosition(dom.root,position(),600,value=>done.push(value))
  cleanup(); dom.ready(); api.notify(); api.clock(5000)
  assert.deepEqual(done,[])
  assert.deepEqual(dom.scrolled,[])
  assert.equal(api.tasks.size,0)
})

test('layout correction has a hard bound even if continuous geometry never settles', () => {
  const api = harness(), dom = pageDom(), done=[]
  dom.ready(); api.restoreReadingPosition(dom.root,position(),600,value=>done.push(value)); api.clock(16)
  for(let i=0;i<9;i++){ dom.shift(10); api.notify(); api.clock(500) }
  assert.deepEqual(done,[true])
  assert.equal(api.tasks.size,0)
})

test('Host source is authoritative across browser origins and local values only migrate when absent', async () => {
  const api = harness(), doc = {id:'new-version-id',path:'C:/book.pdf'}
  api.saveReadingPosition(doc.path,position(40))
  api.state.host = {ok:true, position:{pageNumber:12,x:.1,y:.2,updatedAt:'2026-11-13T01:00:00Z'}}
  assert.equal((await api.fetchReadingPosition(doc)).pageNumber,12)
  api.storage.clear() // Simulate new DSH port / localStorage origin.
  assert.equal((await api.fetchReadingPosition(doc)).pageNumber,12)
  api.state.host = {ok:true,position:null}; api.saveReadingPosition(doc.path,position(40))
  assert.equal((await api.fetchReadingPosition(doc)).pageNumber,40)
  api.state.failFetch = true
  assert.equal((await api.fetchReadingPosition(doc)).pageNumber,40)
  assert.equal(doc.readerPositionWarning,true)
})

test('rapid same-document reopening waits for final flush before reading Host position', async () => {
  const api = harness()
  let complete
  api.state.host = {ok:true,position:{pageNumber:1,x:0,y:0}}
  api.state.fetchImplementation = () => new Promise(resolve=>{ complete=resolve })
  api.persistReadingPosition('doc-a','C:/a.pdf',position(27))
  const reopening = api.fetchReadingPosition({id:'doc-a',path:'C:/a.pdf'})
  assert.equal(api.requests.filter(request=>request.get).length,0)
  api.state.host = {ok:true,position:{pageNumber:27,x:.2,y:.45}}
  complete({ok:true,json:async()=>api.state.host})
  assert.equal((await reopening).pageNumber,27)
  assert.equal(api.requests.filter(request=>request.get).length,1)
})

test('stalled or failed Host saves retain latest same-window snapshot on reopening', async () => {
  const api = harness(), doc={id:'doc-a',path:'C:/a.pdf'}
  api.state.host = {ok:true,position:{pageNumber:1,x:0,y:0}}
  api.state.fetchImplementation = () => new Promise(()=>{})
  api.persistReadingPosition('doc-a',doc.path,position(33))
  const reopening=api.fetchReadingPosition(doc)
  api.clock(2000)
  assert.equal((await reopening).pageNumber,33)
  assert.equal(doc.readerPositionWarning,true)
  assert.equal(api.requests.filter(request=>request.get).length,0)
})

test('Host writes use keepalive, stable doc snapshot and monotonic revision without local schema fields', async () => {
  const api = harness(), warnings=[]
  api.persistReadingPosition('doc-a','C:/a.pdf',position(7),value=>warnings.push(value))
  api.persistReadingPosition('doc-b','C:/b.pdf',position(9),value=>warnings.push(value))
  assert.equal(api.requests.length,2)
  const first = JSON.parse(api.requests[0].options.body), second=JSON.parse(api.requests[1].options.body)
  assert.equal(first.docId,'doc-a'); assert.equal(second.docId,'doc-b')
  assert.equal(first.writerId,second.writerId); assert.ok(second.revision>first.revision)
  assert.equal(first.position.version,undefined)
  assert.equal(api.requests[0].options.keepalive,true)
  assert.equal(api.requests[0].options.headers['x-dsh-study'],'1')
  await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(warnings,[false,false])
  api.state.failFetch=true
  api.persistReadingPosition('doc-a','C:/a.pdf',position(10),value=>warnings.push(value))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(warnings.at(-1),true)
  assert.equal(api.loadReadingPosition('C:/a.pdf').pageNumber,10)
})
