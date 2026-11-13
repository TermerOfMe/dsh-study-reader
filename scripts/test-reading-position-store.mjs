import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReadingPositionStore } from '../lib/reading-position.js'

const documentPath = 'C:\\books\\book.pdf'
const point = n => ({ pageNumber: n, x: .2, y: .6 })
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'study-position-'))
  try { await run(join(root, 'positions')) } finally { await rm(root, { recursive: true, force: true }) }
}
const store = directory => createReadingPositionStore({ directory })

test('absent reads are null and do not create storage', () => fixture(async directory => {
  assert.equal(await store(directory).get(documentPath), null)
  await assert.rejects(stat(directory), { code: 'ENOENT' })
}))
test('last position persists across instances and detached results preserve server clock', () => fixture(async directory => {
  const first = store(directory)
  const saved = await first.set(documentPath, point(12))
  assert.equal(new Date(saved.updatedAt).toISOString(), saved.updatedAt)
  saved.pageNumber = 99
  const loaded = await store(directory).get(documentPath)
  assert.equal(loaded.pageNumber, 12)
  loaded.y = 0
  assert.equal((await first.get(documentPath)).y, .6)
  const updated = await first.set(documentPath, point(4))
  assert.ok(updated.updatedAt >= loaded.updatedAt)
  assert.equal((await store(directory).get(documentPath)).pageNumber, 4)
}))
test('Windows aliases share a position but other paths and same basenames remain isolated', () => fixture(async directory => {
  const first = store(directory)
  await first.set('C:\\BOOKS\\sub\\..\\Book.pdf', point(9))
  for (const alias of ['c:/books/book.pdf', '\\\\?\\C:\\books\\book.pdf']) assert.equal((await first.get(alias)).pageNumber, 9)
  assert.equal(await first.get('C:\\other\\book.pdf'), null)
  assert.equal(await first.get('C:\\books\\other.pdf'), null)
  await first.set('\\\\server\\share\\book.pdf', point(2))
  assert.equal((await first.get('\\\\?\\UNC\\SERVER\\SHARE\\book.pdf')).pageNumber, 2)
}))
test('queued writes snapshot caller data, serialize across instances, and reads await prior writes', () => fixture(async directory => {
  const a = store(directory), b = store(directory), input = point(1)
  const first = a.set(documentPath, input)
  input.pageNumber = 500
  const writes = [first]
  for (let n = 2; n <= 20; n++) writes.push((n % 2 ? a : b).set(documentPath, point(n)))
  const last = b.get(documentPath)
  await Promise.all(writes)
  assert.equal((await last).pageNumber, 20)
  assert.equal((await first).pageNumber, 1)
  assert.equal((await readdir(directory)).length, 1)
}))
test('higher writer revision wins when final lifecycle write arrives before an earlier request', () => fixture(async directory => {
  const a = store(directory), b = store(directory)
  await a.set(documentPath, point(10), { writerId: 'tab-a', revision: 2 })
  const stale = await b.set(documentPath, point(3), { writerId: 'tab-a', revision: 1 })
  assert.equal(stale.pageNumber, 10)
  assert.equal((await a.set(documentPath, point(4), { writerId: 'tab-a', revision: 2 })).pageNumber, 10)
  assert.equal((await a.set(documentPath, point(11), { writerId: 'tab-a', revision: 3 })).pageNumber, 11)
  assert.equal((await b.set(documentPath, point(12), { writerId: 'tab-b', revision: 1 })).pageNumber, 12)
}))
test('invalid coordinates, pages, fields, paths and ordering create no files', () => fixture(async directory => {
  const a = store(directory)
  for (const value of [null, [], {}, point(0), point(-1), point(1.5), point(Number.MAX_SAFE_INTEGER + 1), { ...point(1), x: NaN }, { ...point(1), x: Infinity }, { ...point(1), x: -.1 }, { ...point(1), y: 1.1 }, { ...point(1), y: '0' }, { ...point(1), updatedAt: new Date().toISOString() }]) await assert.rejects(a.set(documentPath, value), { code: 'READING_POSITION_VALIDATION' })
  for (const value of ['', 'relative.pdf', 'C:book.pdf', '\\root.pdf', 'C:\\book\0.pdf']) await assert.rejects(a.get(value), { code: 'READING_POSITION_VALIDATION' })
  for (const ordering of [{ writerId: 'x' }, { revision: 1 }, { writerId: '', revision: 1 }, { writerId: 'x'.repeat(101), revision: 1 }, { writerId: 'x', revision: 0 }]) await assert.rejects(a.set(documentPath, point(1), ordering), { code: 'READING_POSITION_VALIDATION' })
  await assert.rejects(stat(directory), { code: 'ENOENT' })
}))
test('malformed and future-schema saved files fail explicitly without replacement', () => fixture(async directory => {
  const a = store(directory)
  await a.set(documentPath, point(1))
  const file = join(directory, (await readdir(directory))[0])
  const original = JSON.parse(await readFile(file, 'utf8'))
  for (const text of ['{', JSON.stringify({ ...original, schemaVersion: 2 }), JSON.stringify({ ...original, documentPath: 'c:\\other.pdf' }), JSON.stringify({ ...original, position: { ...original.position, y: 9 } }), JSON.stringify({ ...original, position: { ...original.position, updatedAt: 'yesterday' } }), JSON.stringify({ ...original, unknown: true })]) {
    await writeFile(file, text)
    await assert.rejects(a.get(documentPath), { code: 'READING_POSITION_CORRUPT' })
    await assert.rejects(a.set(documentPath, point(2)), { code: 'READING_POSITION_CORRUPT' })
    assert.equal(await readFile(file, 'utf8'), text)
  }
  await writeFile(file, JSON.stringify(original))
  assert.equal((await a.set(documentPath, point(3))).pageNumber, 3)
}))
test('atomic replacement exposes complete old or new JSON and cleans temporary files', () => fixture(async directory => {
  const a = store(directory)
  await a.set(documentPath, point(1))
  const file = join(directory, (await readdir(directory))[0])
  let reads = 0
  const reader = (async () => {
    for (let index = 0; index < 100; index++) {
      const data = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(data.schemaVersion, 1)
      assert.equal(data.position.x, .2)
      reads++
    }
  })()
  const writing = (async () => { for (let n = 2; n <= 15; n++) await a.set(documentPath, point(n)) })()
  await Promise.all([writing, reader])
  assert.ok(reads > 0)
  assert.equal((await readdir(directory)).length, 1)
}))
