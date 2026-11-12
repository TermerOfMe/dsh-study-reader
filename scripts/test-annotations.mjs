import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createAnnotationStore } from '../lib/annotations.js'

const DOC = 'C:\\Books\\教材.pdf'
const RECT = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
const validation = { code: 'ANNOTATION_VALIDATION' }
const corrupt = { code: 'ANNOTATION_CORRUPT' }

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-annotations-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, store: createAnnotationStore({ directory }) }
}

async function jsonFile(directory) {
  const files = (await readdir(directory)).filter(name => name.endsWith('.json'))
  assert.equal(files.length, 1)
  return path.join(directory, files[0])
}

test('missing directory/document returns empty without creating storage or files', async t => {
  const { directory } = await fixture(t)
  const absent = path.join(directory, 'absent')
  const store = createAnnotationStore({ directory: absent })
  assert.deepEqual(await store.list(DOC), [])
  assert.equal(await store.remove(DOC, randomUUID()), false)
  assert.deepEqual(await readdir(directory), [])
})

test('bookmarks persist across new store instances and support page or region scope', async t => {
  const { directory, store } = await fixture(t)
  const page = await store.upsert(DOC, { type: 'bookmark', pdfPage: 7, blockId: 0 })
  const region = await store.upsert(DOC, { type: 'bookmark', pdfPage: 8, crop: RECT })
  assert.match(page.id, /^[0-9a-f-]{36}$/)
  assert.notEqual(page.id, region.id)
  assert.equal(page.scope, 'page')
  assert.equal(region.scope, 'region')
  assert.equal(page.blockId, 0)
  assert.equal(page.createdAt, new Date(page.createdAt).toISOString())
  assert.equal(page.createdAt, page.updatedAt)
  assert.deepEqual(await createAnnotationStore({ directory }).list(DOC), [page, region])
  const file = await jsonFile(directory)
  assert.match(path.basename(file), /^[a-f0-9]{64}\.json$/)
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), [])
})

test('updates preserve identity/creation and omitted fields, clear explicit optional fields', async t => {
  const { store } = await fixture(t)
  const first = await store.upsert(DOC, { type: 'highlight', pdfPage: 3, blockId: 5, crop: RECT, rects: [RECT], quote: '原文', note: 'note', tags: ['tag'] })
  const updated = await store.upsert(DOC, { id: first.id, note: 'changed', createdAt: '2000-01-01T00:00:00.000Z' })
  assert.equal(updated.id, first.id)
  assert.equal(updated.createdAt, first.createdAt)
  assert.ok(updated.updatedAt >= first.updatedAt)
  assert.deepEqual(updated.rects, [RECT])
  assert.equal(updated.quote, '原文')
  const cleared = await store.upsert(DOC, { id: first.id, blockId: null, crop: null, rects: [], quote: '', note: '', tags: [] })
  assert.equal(cleared.scope, 'page')
  assert.equal(cleared.crop, undefined)
  assert.equal(cleared.blockId, undefined)
  assert.deepEqual(cleared.tags, [])
  assert.equal(cleared.note, '')
  assert.equal((await store.list(DOC)).length, 1)
})

test('Windows aliases normalize slash, dot segments, case, and extended path spelling', async t => {
  const { directory, store } = await fixture(t)
  const saved = await store.upsert('C:/BOOKS/chapters/../教材.pdf', { type: 'note', pdfPage: 1, note: '同一文件' })
  assert.deepEqual(await store.list('c:\\books\\教材.PDF'), [saved])
  assert.deepEqual(await store.list('\\\\?\\C:\\Books\\教材.pdf'), [saved])
  assert.equal((await readdir(directory)).length, 1)
  await store.upsert('\\\\SERVER\\Share\\Book.pdf', { type: 'bookmark', pdfPage: 2 })
  assert.equal((await store.list('\\\\?\\UNC\\server\\share\\book.PDF')).length, 1)
})

test('document identity isolates same basenames and denies foreign ids without side effects', async t => {
  const { store, directory } = await fixture(t)
  const saved = await store.upsert(DOC, { type: 'note', pdfPage: 9, note: 'private' })
  const other = 'D:\\Books\\教材.pdf'
  assert.deepEqual(await store.list(other), [])
  await assert.rejects(store.upsert(other, { ...saved, note: 'foreign' }), validation)
  assert.equal(await store.remove(other, saved.id), false)
  assert.deepEqual(await store.list(DOC), [saved])
  assert.equal((await readdir(directory)).length, 1)
})

test('serialized concurrent read/modify/write across instances loses no updates', async t => {
  const { directory, store } = await fixture(t)
  const second = createAnnotationStore({ directory })
  const saved = await Promise.all(Array.from({ length: 36 }, (_, index) => (index % 2 ? store : second).upsert(DOC, {
    type: 'note', pdfPage: index + 1, note: `note-${index}`,
  })))
  assert.equal((await store.list(DOC)).length, 36)
  const changes = saved.map((item, index) => second.upsert(DOC, { id: item.id, note: `updated-${index}` }))
  const removal = store.remove(DOC, saved[0].id)
  const readAfter = store.list(DOC)
  await Promise.all([...changes, removal])
  const listed = await readAfter
  assert.equal(listed.length, 35)
  assert.equal(new Set(listed.map(item => item.id)).size, 35)
  assert.ok(listed.every(item => item.note.startsWith('updated-')))
  assert.deepEqual(await createAnnotationStore({ directory }).list(DOC), listed)
})

test('caller mutations and returned snapshots cannot mutate queued or persisted data', async t => {
  const { store } = await fixture(t)
  const input = { type: 'highlight', pdfPage: 1, rects: [{ ...RECT }], tags: ['original'] }
  const pending = store.upsert(DOC, input)
  input.tags[0] = 'mutated'
  input.rects[0].x = 0.9
  const result = await pending
  assert.deepEqual(result.tags, ['original'])
  assert.equal(result.rects[0].x, RECT.x)
  result.tags.push('external')
  const listed = await store.list(DOC)
  listed[0].rects[0].x = 0.8
  const exported = await store.export(DOC)
  assert.equal(exported.schemaVersion, 1)
  assert.equal(exported.documentPath, 'c:\\books\\教材.pdf')
  assert.deepEqual(exported.annotations[0].tags, ['original'])
  assert.deepEqual(exported.annotations[0].rects, [RECT])
})

test('full accepted limits round trip without silently truncating meaningful fields', async t => {
  const { store } = await fixture(t)
  const input = {
    type: 'highlight', pdfPage: 2, blockId: 0, crop: { x: 0, y: 0, width: 1, height: 1 },
    rects: Array.from({ length: 256 }, () => ({ ...RECT })),
    quote: '文'.repeat(8000), note: '字'.repeat(20000), tags: Array.from({ length: 16 }, () => 't'.repeat(80)),
  }
  const saved = await store.upsert(DOC, input)
  assert.equal(saved.quote, input.quote)
  assert.equal(saved.note, input.note)
  assert.deepEqual(saved.tags, input.tags)
  assert.deepEqual(saved.rects, input.rects)
  assert.deepEqual(await store.list(DOC), [saved])
})

test('rejects invalid types, fields, integer pages, region bounds and oversize content', async t => {
  const { directory, store } = await fixture(t)
  const base = { type: 'bookmark', pdfPage: 1 }
  const cases = [
    null, [], {}, { ...base, type: 'unknown' }, { ...base, pdfPage: 0 }, { ...base, pdfPage: 1.5 },
    { ...base, pdfPage: '1' }, { ...base, blockId: -1 }, { ...base, blockId: NaN },
    { ...base, id: '../escape' }, { ...base, quote: null }, { ...base, note: null },
    { ...base, quote: 'q'.repeat(8001) }, { ...base, note: 'n'.repeat(20001) },
    { ...base, tags: Array(17).fill('t') }, { ...base, tags: ['t'.repeat(81)] }, { ...base, tags: [5] },
    { ...base, rects: Array(257).fill(RECT) }, { ...base, rects: {} },
    { ...base, crop: { ...RECT, width: 0 } }, { ...base, crop: { ...RECT, x: -0.1 } },
    { ...base, crop: { ...RECT, x: 0.9 } }, { ...base, crop: { ...RECT, x: Infinity } },
    { ...base, crop: { ...RECT, x: '0.1' } }, { ...base, rects: [{ ...RECT, extra: 1 }] },
    { ...base, scope: 'region' }, { ...base, unknown: 'never discard me' },
    { ...base, createdAt: 'invalid' },
  ]
  for (const input of cases) await assert.rejects(store.upsert(DOC, input), validation)
  for (const doc of ['', 'relative.pdf', 'C:relative.pdf', '\\root-relative.pdf', 'C:\\null\0.pdf']) {
    await assert.rejects(store.list(doc), validation)
  }
  assert.deepEqual(await readdir(directory), [])
  // Failed validations do not poison the operation queue.
  assert.equal((await store.upsert(DOC, base)).pdfPage, 1)
})

test('corrupt JSON fails explicitly for list/upsert/remove/export and preserves original bytes', async t => {
  const { directory, store } = await fixture(t)
  const saved = await store.upsert(DOC, { type: 'bookmark', pdfPage: 1 })
  const file = await jsonFile(directory)
  const broken = '{"annotations": [unfinished'
  await writeFile(file, broken)
  for (const action of [() => store.list(DOC), () => store.upsert(DOC, { type: 'note', pdfPage: 2 }), () => store.remove(DOC, saved.id), () => store.export(DOC)]) {
    await assert.rejects(action(), corrupt)
    assert.equal(await readFile(file, 'utf8'), broken)
  }
  assert.equal((await readdir(directory)).length, 1)
})

test('valid JSON with wrong path, future schema, duplicate ids or invalid records is corrupt', async t => {
  const { directory, store } = await fixture(t)
  const saved = await store.upsert(DOC, { type: 'bookmark', pdfPage: 1 })
  const file = await jsonFile(directory)
  const valid = await store.export(DOC)
  const cases = [
    { ...valid, documentPath: 'd:\\other.pdf' }, { ...valid, schemaVersion: 2 },
    { ...valid, annotations: [saved, saved] }, { ...valid, annotations: [{ ...saved, pdfPage: 0 }] },
    { ...valid, annotations: [{ ...saved, createdAt: 'bad' }] }, { ...valid, annotations: [{ ...saved, scope: 'region' }] },
    { ...valid, annotations: [{ ...saved, quote: 'q'.repeat(8001) }] },
    { ...valid, annotations: [{ ...saved, note: null }] },
    { ...valid, annotations: [{ ...saved, blockId: null }] },
    { ...valid, annotations: [{ ...saved, tags: undefined }] },
  ]
  for (const data of cases) {
    const original = JSON.stringify(data)
    await writeFile(file, original)
    await assert.rejects(store.upsert(DOC, { id: saved.id, note: 'must not overwrite' }), corrupt)
    assert.equal(await readFile(file, 'utf8'), original)
  }
  // Explicit operator repair can unblock the queue without recreating a store.
  await writeFile(file, JSON.stringify(valid))
  assert.equal((await store.upsert(DOC, { id: saved.id, note: 'repaired' })).note, 'repaired')
})

test('atomic replacement exposes only complete old or new JSON to raw disk readers', async t => {
  const { directory, store } = await fixture(t)
  const saved = await store.upsert(DOC, { type: 'note', pdfPage: 1, note: 'before' })
  const file = await jsonFile(directory)
  const writing = Promise.all(Array.from({ length: 20 }, (_, index) => store.upsert(DOC, {
    id: saved.id, note: `revision-${index} ${'content'.repeat(1000)}`,
  })))
  const reading = (async () => {
    for (let index = 0; index < 100; index += 1) {
      const data = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(data.annotations.length, 1)
      assert.equal(data.annotations[0].id, saved.id)
      assert.ok(data.annotations[0].note === 'before' || data.annotations[0].note.startsWith('revision-'))
    }
  })()
  await Promise.all([writing, reading])
  assert.ok((await store.list(DOC))[0].note.startsWith('revision-19 '))
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), [])
})

test('remove is durable/idempotent and leaves other documents untouched', async t => {
  const { directory, store } = await fixture(t)
  const a = await store.upsert(DOC, { type: 'bookmark', pdfPage: 1 })
  const b = await store.upsert('C:\\Other.pdf', { type: 'bookmark', pdfPage: 3 })
  assert.equal(await store.remove(DOC, a.id), true)
  assert.equal(await store.remove(DOC, a.id), false)
  const reopened = createAnnotationStore({ directory })
  assert.deepEqual(await reopened.list(DOC), [])
  assert.deepEqual(await reopened.list('C:\\Other.pdf'), [b])
  const expected = createHash('sha256').update('c:\\books\\教材.pdf').digest('hex')
  assert.ok((await readdir(directory)).includes(`${expected}.json`))
})
