import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createConversationStore } from '../lib/conversations.js'
import { listConfiguredModels, resolveRequestModel, streamCompletion } from '../lib/llm.js'
const conversation = id => ({ id, title: 'Thread', messages: [{ id: 'message-1', role: 'assistant', text: 'answer', custom: { reasoning: 'preserved', pages: [1,2] } }], draft: 'draft', quote: null, modelSelection: null, mode: 'learn', createdAt: Date.now(), updatedAt: Date.now() })
async function fixture(fn) { const directory = await mkdtemp(join(tmpdir(), 'study-conversations-')); try { await fn(createConversationStore({ directory }), directory) } finally { await rm(directory, { recursive: true, force: true }) } }
test('missing records do not create storage and saved metadata persists across reopen and Windows aliases', () => fixture(async (store, directory) => {
  const file = 'C:\\docs\\paper.pdf'
  assert.deepEqual(await store.get(file), { conversations: [], activeId: null })
  assert.equal((await readdir(directory)).length, 0)
  const record = conversation('a')
  await store.mutate(file, { action: 'save', conversation: record, activeId: 'a' })
  assert.deepEqual(await createConversationStore({ directory }).get('c:/docs/paper.pdf'), { conversations: [record], activeId: 'a' })
}))
test('updates only one record and delete preserves other threads with validated active selection', () => fixture(async store => {
  const file = 'C:/docs/a.pdf', a = conversation('a'), b = conversation('b')
  await store.mutate(file, { action: 'save', conversation: a, activeId: 'a' })
  await store.mutate(file, { action: 'save', conversation: b })
  a.title = 'renamed'; a.parentId = 'b'; a.forkMessageId = 'message-1'
  await store.mutate(file, { action: 'save', conversation: a })
  assert.equal((await store.get(file)).conversations[1].title, 'Thread')
  const result = await store.mutate(file, { action: 'remove', id: 'a', activeId: 'b' })
  assert.deepEqual(result, { conversations: [b], activeId: 'b' })
  assert.equal((await store.mutate(file, { action: 'remove', id: 'b' })).activeId, null)
}))
test('concurrent saves across instances lose no threads and snapshot caller payload', () => fixture(async (store, directory) => {
  const record = conversation('a'), pending = store.mutate('C:/a.pdf', { action: 'save', conversation: record })
  record.title = 'mutation'
  await Promise.all([pending, createConversationStore({ directory }).mutate('C:/a.pdf', { action: 'save', conversation: conversation('b') })])
  const result = await store.get('C:/a.pdf')
  assert.equal(result.conversations.length, 2)
  assert.equal(result.conversations[0].title, 'Thread')
}))
test('invalid active id, payload size, non-JSON metadata and unknown fields reject without truncation', () => fixture(async store => {
  const file = 'C:/a.pdf'
  for (const bad of [{ ...conversation('a'), draft: 'x'.repeat(20001) }, { ...conversation('a'), messages: [{ text: 'x'.repeat(900001) }] }, { ...conversation('a'), mode: 'bad' }, { ...conversation('a'), unknown: true }, { ...conversation('a'), messages: [{ nested: undefined }] }]) await assert.rejects(store.mutate(file, { action: 'save', conversation: bad }), { code: 'CONVERSATION_VALIDATION' })
  await assert.rejects(store.mutate(file, { action: 'save', conversation: conversation('a'), activeId: 'missing' }), { code: 'CONVERSATION_VALIDATION' })
  assert.equal((await store.get(file)).conversations.length, 0)
}))
test('corrupt storage is reported and preserved', () => fixture(async (store, directory) => {
  await store.mutate('C:/a.pdf', { action: 'save', conversation: conversation('a') })
  await writeFile(join(directory, (await readdir(directory))[0]), '{broken')
  await assert.rejects(store.get('C:/a.pdf'), { code: 'CONVERSATION_CORRUPT' })
  await assert.rejects(store.mutate('C:/a.pdf', { action: 'remove', id: 'a' }), { code: 'CONVERSATION_CORRUPT' })
}))
test('configured catalogue tolerates one failed provider and validates explicit selection without global mutation', async () => {
  const calls = []
  const ctx = { get(name) { if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'default', model: 'default' }) }; if (name === 'llm') return {
    listProviders: async () => [{ id: 'chosen', name: 'Chosen' }, { id: 'failed', name: 'Failed' }],
    listModels: async provider => { if (provider === 'failed') throw new Error('offline'); return [{ provider, id: 'vision', name: 'Vision' }] },
    async *stream(options) { calls.push(options); yield { type: 'text-delta', text: 'OK' }; yield { type: 'finish', reason: { kind: 'stop' } } },
  } } }
  const catalogue = await listConfiguredModels(ctx)
  assert.deepEqual(catalogue.models, [{ provider: 'chosen', model: 'vision', name: 'Vision', providerName: 'Chosen' }])
  assert.equal(catalogue.errors[0].provider, 'failed')
  const selection = await resolveRequestModel(ctx, { provider: 'chosen', model: 'vision' })
  await streamCompletion({ ctx, system: 'test', prompt: 'test', maxTokens: 64, modelSelection: selection })
  assert.equal(calls[0].provider, 'chosen'); assert.equal(calls[0].model, 'vision')
  assert.deepEqual(await resolveRequestModel(ctx, null), { provider: 'default', model: 'default' })
  await assert.rejects(resolveRequestModel(ctx, { provider: 'chosen', model: 'not-configured' }), { code: 'bad-model-selection' })
  await assert.rejects(resolveRequestModel(ctx, { provider: 'chosen', model: 'vision', extra: true }), { code: 'bad-model-selection' })
})
