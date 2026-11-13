import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReadingSession, answerWithReading, estimateRequest } from '../lib/reading.js'
import { DEFAULTS } from '../lib/app.js'

// Only the image-production boundary and streamed LLM transport are substituted.
// Session policy, partial-result construction, admission and commits are real.
const doc = {
  title: 'Partial image regression', kind: 'pdf', extension: 'pdf', stats: { chars: 100 }, toc: [],
  pages: Array.from({ length: 6 }, (_, i) => ({ label: `Page ${i + 1}` })),
  blocks: Array.from({ length: 6 }, (_, i) => ({ id: i, page: i, type: 'paragraph', text: `Page ${i + 1} evidence` })),
}
const config = { adaptiveReading: true, readingMaxRounds: 3, readingMaxPages: 6,
  maxAnswerTokens: 1024, maxInputTokens: 24000, readingTotalTokens: 96000, temperature: 0.3 }
const packed = page => ({ ref: { attachmentId: `image-${page}`, mediaType: 'image/jpeg', width: 100, height: 100, bytes: 100 }, meta: { page, kind: 'page', width: 100, height: 100 } })
const makeSession = options => createReadingSession({ doc, mode: 'reread', anchor: 5, currentPage: 4, config, vision: true, getImage: async page => packed(page), ...options })
const call = (pages, extra = {}) => ({ id: 'read-images', name: 'document_read', arguments: JSON.stringify({ pages, format: 'image', offset: 0, crop: null, reason: 'Inspect figures', ...extra }) })
const payload = result => JSON.parse(result.text)
const ids = result => result.images.map(image => image.attachmentId)
const seen = session => [...session.seenPages]
const assertEmpty = session => { assert.deepEqual(session.images, []); assert.deepEqual(seen(session), []) }

test('success/failure/success keeps ordered attachments and contiguous imageIndex references', async () => {
  const invoked = []
  const session = makeSession({ getImage: async page => { invoked.push(page); if (page === 2) throw Error('page two render failed'); return packed(page) } })
  const result = await session.execute(call([1, 2, 3]))
  assert.equal(result.isError, undefined)
  assert.deepEqual(invoked, [1, 2, 3])
  assert.deepEqual(ids(result), ['image-1', 'image-3'])
  const pages = payload(result).pages
  assert.deepEqual(pages.map(page => page.page), [1, 2, 3])
  assert.equal(pages[0].imageIndex, 0)
  assert.match(pages[1].error, /page two render failed/)
  assert.equal(pages[1].imageIndex, undefined)
  assert.equal(pages[2].imageIndex, 1)
  for (const page of pages.filter(page => !page.error)) assert.equal(result.images[page.imageIndex].attachmentId, `image-${page.page}`)
  assert.deepEqual(seen(session), [1, 3])
  assert.deepEqual(session.images.map(image => image.page), [1, 3])
  assert.equal(payload(result).remainingPages, 4)
  assert.deepEqual(session.traces[0].failures.map(item => item.page), [2])
  assert.equal(session.traces[0].status, 'done')
})

test('learn current-page crop stays forbidden while preceding allowed image is retained', async () => {
  const invoked = [], crop = { x: 0, y: 0, width: .4, height: .3 }
  const session = makeSession({ mode: 'learn', currentPage: 4, anchor: 3, getImage: async (page, actualCrop) => { invoked.push(page); assert.deepEqual(actualCrop, crop); return packed(page) } })
  const result = await session.execute(call([3, 4], { crop }))
  assert.deepEqual(invoked, [3])
  assert.deepEqual(ids(result), ['image-3'])
  assert.match(payload(result).pages[1].error, /学习模式/)
  assert.deepEqual(seen(session), [3])
  assert.equal(result.isError, undefined)
})

test('mixed future and invalid page numbers never render, but an allowed middle page succeeds', async () => {
  for (const invalid of [0, -1, 1.5, '2', null]) {
    const invoked = []
    const session = makeSession({ mode: 'learn', currentPage: 4, anchor: 3, getImage: async page => { invoked.push(page); return packed(page) } })
    const result = await session.execute(call([invalid, 2, 5]))
    assert.deepEqual(invoked, [2], `forbidden input ${JSON.stringify(invalid)} must never reach renderer`)
    assert.deepEqual(ids(result), ['image-2'])
    assert.deepEqual(payload(result).pages.map(page => Boolean(page.error)), [true, false, true])
    assert.deepEqual(seen(session), [2])
  }
})

test('image cap retains the earlier successful image and does not call later renderer', async () => {
  const invoked = []
  const session = makeSession({ imageLimit: 1, getImage: async page => { invoked.push(page); return packed(page) } })
  const result = await session.execute(call([1, 2, 3]))
  assert.deepEqual(invoked, [1])
  assert.deepEqual(ids(result), ['image-1'])
  assert.ok(payload(result).pages.slice(1).every(page => /图片数量限制/.test(page.error)))
  assert.deepEqual(seen(session), [1])
  assert.equal(result.isError, undefined)
})

test('failed render and missing image ref consume no page allowance or image quota', async () => {
  const invoked = []
  const session = makeSession({ imageLimit: 1, config: { ...config, readingMaxPages: 1 }, getImage: async page => {
    invoked.push(page)
    if (page === 1) throw Error('failed')
    if (page === 2) return { record: {} }
    return packed(page)
  } })
  const result = await session.execute(call([1, 2, 3]))
  assert.deepEqual(invoked, [1, 2, 3])
  assert.deepEqual(ids(result), ['image-3'])
  assert.deepEqual(seen(session), [3])
  assert.equal(payload(result).remainingPages, 0)
})

test('repeated partial batch reuses admitted success and retries only the failed page', async () => {
  const invoked = []; let failed = false
  const session = makeSession({ imageLimit: 2, getImage: async page => {
    invoked.push(page)
    if (page === 2 && !failed) { failed = true; throw Error('transient failure') }
    return packed(page)
  } })
  assert.deepEqual(ids(await session.execute(call([1, 2]))), ['image-1'])
  const retry = await session.execute(call([1, 2]))
  assert.deepEqual(invoked, [1, 2, 2])
  assert.deepEqual(ids(retry), ['image-2'])
  const pages = payload(retry).pages
  assert.match(pages[0].note, /此前工具消息/)
  assert.equal(pages[0].imageIndex, undefined)
  assert.equal(pages[1].imageIndex, 0)
  const reused = await session.execute(call([1, 2]))
  assert.deepEqual(ids(reused), [])
  assert.equal(reused.isError, undefined)
  assert.deepEqual(invoked, [1, 2, 2])
  assert.deepEqual(seen(session), [1, 2])
  assert.equal(session.images.length, 2)
})

test('deferred rejected result commits no caches, page quota or images; identical retry renders again', async () => {
  const invoked = []
  const session = makeSession({ imageLimit: 1, config: { ...config, readingMaxPages: 1 }, getImage: async page => { invoked.push(page); return packed(page) } })
  const pending = await session.execute(call([1, 2]), { deferCommit: true })
  assert.deepEqual(ids(pending), ['image-1'])
  assertEmpty(session)
  assert.equal(session.traces.length, 0)
  pending.commit(false, 'budget rejected')
  pending.commit(true) // Commit is one-shot: cannot reverse rejection.
  assertEmpty(session)
  assert.equal(session.traces[0].status, 'error')
  assert.match(session.traces[0].summary, /budget rejected/)
  const retry = await session.execute(call([1, 2]))
  assert.deepEqual(ids(retry), ['image-1'])
  assert.deepEqual(invoked, [1, 1])
  assert.deepEqual(seen(session), [1])
  assert.equal(session.images.length, 1)
})

test('all per-page failures return isError and preserve capacity for a later successful retry', async () => {
  let available = false
  const session = makeSession({ imageLimit: 1, config: { ...config, readingMaxPages: 1 }, getImage: async page => { if (!available) throw Error('offline'); return packed(page) } })
  const failed = await session.execute(call([1, 2, 3]))
  assert.equal(failed.isError, true)
  assert.deepEqual(failed.images, [])
  assert.equal(payload(failed).pages.length, 3)
  assert.ok(payload(failed).pages.every(page => /offline/.test(page.error)))
  assert.match(payload(failed).error, /均未读取成功/)
  assert.equal(payload(failed).remainingPages, 1)
  assertEmpty(session)
  available = true
  assert.deepEqual(ids(await session.execute(call([1]))), ['image-1'])
})

test('cancellation after an earlier successful render throws and admits none of the batch', async () => {
  const controller = new AbortController(), invoked = []
  const session = makeSession({ signal: controller.signal, getImage: async page => {
    invoked.push(page)
    if (page === 2) controller.abort()
    return packed(page)
  } })
  await assert.rejects(session.execute(call([1, 2, 3]), { deferCommit: true }), /已停止/)
  assert.deepEqual(invoked, [1, 2])
  assertEmpty(session)
  assert.equal(session.traces.length, 1)
  assert.equal(session.traces[0].status, 'aborted')
})

test('pre-cancellation never reaches image callback', async () => {
  const controller = new AbortController(); controller.abort()
  const session = makeSession({ signal: controller.signal, getImage: async () => { assert.fail('aborted read must not render') } })
  await assert.rejects(session.execute(call([1])), /已停止/)
  assertEmpty(session)
})

test('malformed batches, format and JSON protect image callback and leave session untouched', async () => {
  const session = makeSession({ getImage: async () => { assert.fail('malformed read must not render') } })
  const invalidCalls = [call([]), call([1, 2, 3, 4]), call('1'), call(1), call(null), call([1], { format: 'jpeg' }),
    ...['{', 'null', '[]', '42'].map(argumentsText => ({ name: 'document_read', arguments: argumentsText }))]
  for (const invalid of invalidCalls) {
    const result = await session.execute(invalid)
    assert.equal(result.isError, true)
    assert.deepEqual(result.images, [])
    assert.ok(payload(result).error)
    assertEmpty(session)
  }
})

test('duplicate pages render once and text-mode mixed invalid pages remain rejected before any read', async () => {
  const invoked = []
  const session = makeSession({ getImage: async page => { invoked.push(page); return packed(page) } })
  const result = await session.execute(call([1, 1, 2]))
  assert.deepEqual(invoked, [1, 2])
  assert.deepEqual(payload(result).pages.map(page => page.page), [1, 2])
  const textSession = makeSession()
  const textResult = await textSession.execute(call([1, 0], { format: 'text' }))
  assert.equal(textResult.isError, true)
  assertEmpty(textSession)
})

const toolBlock = args => ({ type: 'block-end', index: 0, block: { type: 'tool-call', id: 'partial-call', name: 'document_read', arguments: JSON.stringify(args) } })
function fakeTransport(args, { visualTokens } = {}) {
  const requests = []
  const llm = {
    resolveModelInfo: async () => ({ context: { contextWindow: 32768 } }),
    ...(visualTokens === undefined ? {} : { imageRequestPricing: () => ({ priceImages: pictures => pictures.map(() => ({ visualTokens })) }) }),
    stream: options => {
      requests.push(structuredClone(options))
      const round = requests.length
      return (async function* () {
        if (round === 1) yield toolBlock(args)
        else yield { type: 'text-delta', index: 0, text: 'Answer from admitted evidence' }
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } }
        yield { type: 'finish', reason: { kind: round === 1 ? 'tool-calls' : 'stop' } }
      })()
    },
  }
  return { requests, ctx: { get: name => name === 'llm' ? llm : undefined } }
}
const answer = (ctx, session, extra = {}) => answerWithReading({ ctx, session, model: { provider: 'test', model: 'test-model' },
  built: { system: 'Inspect cited figures.', prompt: 'Describe pages one, two and three.' }, images: [], config, ...extra })

test('actual answerWithReading forwards partial success attachments plus page error in next model request', async () => {
  const transport = fakeTransport({ pages: [1, 2, 3], format: 'image', offset: 0, crop: null, reason: 'Inspect figures' })
  const session = makeSession({ getImage: async page => { if (page === 2) throw Error('figure two unavailable'); return packed(page) } })
  const result = await answer(transport.ctx, session)
  assert.equal(result.text, 'Answer from admitted evidence')
  assert.equal(transport.requests.length, 2)
  const tool = transport.requests[1].messages.find(message => message.role === 'tool')
  assert.ok(tool)
  assert.equal(tool.toolCallId, 'partial-call')
  assert.equal(tool.isError, undefined)
  const text = JSON.parse(tool.content.find(block => block.type === 'text').text)
  assert.match(text.pages[1].error, /figure two unavailable/)
  const attachments = tool.content.filter(block => block.type === 'image').map(block => block.attachment)
  assert.deepEqual(attachments.map(image => image.attachmentId), ['image-1', 'image-3'])
  assert.deepEqual(text.pages.filter(page => !page.error).map(page => page.imageIndex), [0, 1])
  assert.ok(!JSON.stringify(transport.requests[1]).includes('image-2'))
  assert.deepEqual(seen(session), [1, 3])
  assert.equal(session.images.length, 2)
  assert.equal(transport.requests[0].messages.length, 1, 'captured first call must not gain future tool results')
})

test('actual answerWithReading budget rejection omits images and commits no successful page caches', async () => {
  const args = { pages: [1, 2], format: 'image', offset: 0, crop: null, reason: 'Inspect figures' }
  const transport = fakeTransport(args, { visualTokens: 50000 })
  const invoked = []
  const session = makeSession({ imageLimit: 1, config: { ...config, readingMaxPages: 1 }, getImage: async page => { invoked.push(page); return packed(page) } })
  await answer(transport.ctx, session)
  assert.deepEqual(invoked, [1])
  const tool = transport.requests[1].messages.find(message => message.role === 'tool')
  assert.equal(tool.isError, true)
  assert.equal(tool.content.length, 1)
  assert.equal(tool.content[0].type, 'text')
  assert.match(tool.content[0].text, /预算/)
  assertEmpty(session)
  assert.equal(session.traces[0].status, 'error')
  assert.match(session.traces[0].summary, /预算/)
  // A real retry proves that both page cache and image/page quota remained free.
  const retry = await session.execute(call([1, 2]))
  assert.deepEqual(invoked, [1, 1])
  assert.deepEqual(ids(retry), ['image-1'])
  assert.deepEqual(seen(session), [1])
  assert.equal(session.images.length, 1)
})

function assertRequestsWithinBudget(transport, budget) {
  for (const request of transport.requests) {
    const actual = estimateRequest(transport.ctx, { provider: 'test', model: 'test-model' }, request.system, request.messages, request.tools)
    assert.ok(actual <= budget, `complete request ${actual} must fit ${budget}`)
  }
}

test('tool admission shrinks initial replaceable text and retains crop plus allowed images', async () => {
  const args = { pages: [4, 1, 2], format: 'image', offset: 0, crop: null, reason: 'Inspect figures' }
  const transport = fakeTransport(args, { visualTokens: 6000 })
  const invoked = []
  const session = makeSession({ mode: 'learn', currentPage: 4, anchor: 3, getImage: async page => { invoked.push(page); return packed(page) } })
  let fits = 0
  await answer(transport.ctx, session, {
    built: { system: 'Inspect cited figures.', prompt: 'A'.repeat(18000) }, images: [packed('crop').ref],
    fitPrompt: () => { fits++; return 'A'.repeat(fits === 1 ? 8000 : 500) },
  })
  assert.ok(fits > 0, 'tool result must shrink even when initial request fits')
  assert.deepEqual(invoked, [1, 2], 'current page must never render')
  const next = transport.requests[1]
  assert.ok(next.messages[0].content[0].text.length < 18000)
  assert.equal(next.messages[0].content[1].attachment.attachmentId, 'image-crop')
  const tool = next.messages.find(message => message.role === 'tool')
  assert.deepEqual(tool.content.filter(block => block.type === 'image').map(block => block.attachment.attachmentId), ['image-1', 'image-2'])
  assert.match(JSON.parse(tool.content[0].text).pages[0].error, /学习模式/)
  assert.deepEqual(seen(session), [1, 2])
  assertRequestsWithinBudget(transport, 24000)
})

test('budget admits fitting subset and keeps dropped pages retryable', async () => {
  const transport = fakeTransport({ pages: [1, 2, 3], format: 'image', offset: 0, crop: null, reason: 'Inspect' })
  transport.ctx.get('llm').imageRequestPricing = () => ({ priceImages: pictures => pictures.map(block => ({ visualTokens: block.attachment.attachmentId === 'image-1' ? 50000 : 6000 })) })
  const invoked = []
  const session = makeSession({ imageLimit: 3, getImage: async page => { invoked.push(page); return packed(page) } })
  await answer(transport.ctx, session, { config: { ...config, maxInputTokens: 11000 } })
  const tool = transport.requests[1].messages.find(message => message.role === 'tool')
  assert.equal(tool.isError, undefined)
  const pages = JSON.parse(tool.content[0].text).pages
  assert.deepEqual(tool.content.filter(block => block.type === 'image').map(block => block.attachment.attachmentId), ['image-2'])
  assert.deepEqual(pages.map(page => page.imageIndex), [undefined, 0, undefined])
  assert.match(pages[0].error, /预算/)
  assert.match(pages[2].error, /预算/)
  assert.deepEqual(seen(session), [2])
  assert.deepEqual(session.images.map(image => image.page), [2])
  assert.deepEqual(session.traces[0].pages, [2])
  assert.deepEqual(session.traces[0].failures.map(item => item.page), [1, 3])
  assert.equal(JSON.parse(tool.content[0].text).remainingPages, 5)
  const retry = await session.execute(call([2, 3]))
  assert.deepEqual(invoked, [1, 2, 3, 3], 'accepted page cached, dropped page retried')
  assert.deepEqual(ids(retry), ['image-3'])
  assert.deepEqual(seen(session), [2, 3])
  assertRequestsWithinBudget(transport, 11000)
})

test('raised defaults admit crop plus pages 76 and 79 without reading forbidden page 86', async () => {
  const largeDoc = { ...doc, pages: Array.from({ length: 90 }, () => ({})), blocks: Array.from({ length: 90 }, (_, id) => ({ id, page: id, text: `Evidence ${id + 1}` })) }
  const transport = fakeTransport({ pages: [86, 76, 79], format: 'image', offset: 0, crop: null, reason: 'Compare figures' }, { visualTokens: 10000 })
  transport.ctx.get('llm').resolveModelInfo = async () => ({ context: { contextWindow: 128000 } })
  const invoked = []
  const session = createReadingSession({ doc: largeDoc, mode: 'learn', anchor: 85, currentPage: 86,
    config: DEFAULTS, vision: true, imageLimit: 3, getImage: async page => { invoked.push(page); return packed(page) } })
  await answer(transport.ctx, session, { config: DEFAULTS, images: [packed('crop86').ref] })
  assert.deepEqual(invoked, [76, 79])
  const next = transport.requests[1]
  const tool = next.messages.find(message => message.role === 'tool')
  assert.match(JSON.parse(tool.content[0].text).pages[0].error, /学习模式/)
  assert.deepEqual(tool.content.filter(block => block.type === 'image').map(block => block.attachment.attachmentId), ['image-76', 'image-79'])
  assert.deepEqual(seen(session), [76, 79])
  const complete = estimateRequest(transport.ctx, { provider: 'test', model: 'test-model' }, next.system, next.messages, next.tools)
  assert.ok(complete > 24000, 'old artificial cap could not admit this batch')
  assertRequestsWithinBudget(transport, Math.min(DEFAULTS.maxInputTokens, 128000 - 8192 - 1024))
})

test('prompt fitting has a fixed work bound even when every replacement shrinks', async () => {
  const transport = fakeTransport({ pages: [1], format: 'image', offset: 0, crop: null, reason: 'Inspect' }, { visualTokens: 50000 })
  const session = makeSession()
  let attempts = 0
  await answer(transport.ctx, session, { built: { system: 'Inspect.', prompt: 'A'.repeat(20000) },
    fitPrompt: () => 'A'.repeat(20000 - 200 * ++attempts) })
  assert.equal(attempts, 16)
  assert.equal(transport.requests[1].messages[0].content[0].text.length, 16800)
  assertEmpty(session)
  assertRequestsWithinBudget(transport, 24000)
})

test('nonshrinking fitPrompt cannot grow input and terminates immediately', async () => {
  for (const replacement of ['tiny', 'A'.repeat(10000)]) {
    const transport = fakeTransport({ pages: [1], format: 'image', offset: 0, crop: null, reason: 'Inspect' }, { visualTokens: 50000 })
    const session = makeSession()
    let attempts = 0
    await answer(transport.ctx, session, { built: { system: 'Inspect.', prompt: 'tiny' }, fitPrompt: () => { attempts++; return replacement } })
    assert.equal(attempts, 1)
    assert.equal(transport.requests[1].messages[0].content[0].text, 'tiny')
    assertEmpty(session)
    assertRequestsWithinBudget(transport, 24000)
  }
})
