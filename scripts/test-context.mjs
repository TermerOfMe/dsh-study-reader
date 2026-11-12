import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sanitizeHistory, buildLearningContext, buildRereadContext, buildTranslationContext,
  buildAskPrompt, buildTranslatePrompts, searchDocument, renderBlocks, bookMap, acceptAheadMarker,
} from '../lib/context.js'

function document(texts, { toc = [], title = 'Fixture' } = {}) {
  const blocks = texts.map((text, id) => ({ id, page: id, type: 'paragraph', text }))
  return {
    title, kind: 'pdf', kindLabel: 'PDF', blocks, toc,
    pages: texts.map((_, index) => ({ label: `第 ${index + 1} 页`, pdfPage: index + 1 })),
    stats: { chars: texts.reduce((sum, text) => sum + text.length, 0) },
  }
}

const large = label => `${label} ${'ordinary passage '.repeat(700)}`

test('history retains newest complete turns in chronological order with quote and page', () => {
  const history = Array.from({ length: 5 }, (_, index) => [
    { role: 'user', content: `QUESTION${index} ${'q'.repeat(5000)}`, quote: `QUOTE${index}`, page: index + 1 },
    { role: 'assistant', content: `ANSWER${index} ${'a'.repeat(5000)}` },
  ]).flat()
  history.unshift({ role: 'assistant', content: 'ORPHAN' })
  history.push({ role: 'user', content: 'UNANSWERED' })
  const text = sanitizeHistory(history)
  assert.ok(text.length <= 12000)
  assert.match(text, /QUESTION4/)
  assert.match(text, /ANSWER4/)
  assert.match(text, /QUOTE4/)
  assert.match(text, /第 5 页/)
  assert.doesNotMatch(text, /QUESTION0|ORPHAN|UNANSWERED/)
  assert.ok(text.indexOf('QUESTION3') < text.indexOf('QUESTION4'))
  for (let index = 0; index < 5; index += 1) assert.equal(text.includes(`QUESTION${index}`), text.includes(`ANSWER${index}`))
})

test('history supports structured quote and string page metadata without leaking unbounded metadata', () => {
  const text = sanitizeHistory([
    { role: 'user', content: 'What does this mean?', quote: { text: 'citation'.repeat(1000), pdfPage: 7 }, page: 'printed vii' },
    { role: 'assistant', content: 'It means this.' },
  ])
  assert.match(text, /printed vii/)
  assert.match(text, /citation/)
  assert.ok(text.length < 1200)
  assert.equal(sanitizeHistory([{ role: 'user', content: 'alone' }]), '')
})

test('learning giant anchor and directory fit rendered budget, anchor is not duplicated', () => {
  const unique = 'UNIQUE_ANCHOR_SENTENCE'
  const doc = document([unique + 'x'.repeat(100000)], {
    title: 'Title'.repeat(3000),
    toc: Array.from({ length: 400 }, (_, index) => ({ level: 1, title: 'Heading'.repeat(200), page: 0, blockId: 0 })),
  })
  const result = buildLearningContext(doc, 0, { learningContextChars: 4000 })
  assert.ok(result.text.length <= 4000, result.text.length)
  assert.equal(result.trimmed, true)
  assert.equal(result.text.split(unique).length - 1, 1)
  assert.match(result.text, /\[B0\]/)
})

test('small untrimmed learning context reports accurate status', () => {
  const result = buildLearningContext(document(['one', 'two']), 1, {})
  assert.equal(result.trimmed, false)
  assert.deepEqual(result.aheadIds, [])
})

test('learning retrieves earlier relevant evidence but never promotes future evidence into read content', () => {
  const doc = document(['EARLY_DEFINITION Bellman optimality', ...Array.from({ length: 25 }, (_, i) => large(`filler${i}`)), 'CURRENT', 'FUTURE_SECRET Bellman optimality'])
  const result = buildLearningContext(doc, 26, { learningContextChars: 4000, lookaheadChars: 0 }, 'Bellman optimality')
  assert.match(result.text, /EARLY_DEFINITION/)
  assert.match(result.text, /CURRENT/)
  assert.doesNotMatch(result.text, /FUTURE_SECRET/)
  assert.ok(result.text.length <= 4000)
  assert.equal(result.trimmed, true)
})

test('reread allocates relevance before ordering and keeps matching tail of giant evidence', () => {
  const doc = document([large('ANCHOR'), ...Array.from({ length: 30 }, (_, i) => large(`irrelevant${i}`)), 'x'.repeat(40000) + ' RARE_EVIDENCE martingale convergence definition'])
  const result = buildRereadContext(doc, 0, 'martingale convergence', { rereadContextChars: 8000 })
  assert.ok(result.text.length <= 8000)
  assert.match(result.text, /RARE_EVIDENCE/)
  assert.match(result.text, /\[B31\]/)
  assert.equal(result.full, false)
  assert.equal(result.trimmed, true)
})

test('whole-document fast path counts rendered labels, not inaccurate source char stats', () => {
  const doc = document(Array.from({ length: 1000 }, () => 'x'))
  doc.stats.chars = 1
  const result = buildRereadContext(doc, 0, '', { rereadContextChars: 8000 })
  assert.equal(result.full, false)
  assert.ok(result.text.length <= 8000)
  const small = buildRereadContext(document(['a', 'b']), 0, '', {})
  assert.equal(small.full, true)
  assert.equal(small.trimmed, false)
})

test('adaptive contexts cap all text including directory at 8000 chars', () => {
  const doc = document(Array.from({ length: 80 }, (_, i) => large(`block${i}`)), {
    toc: Array.from({ length: 80 }, (_, i) => ({ level: 1, title: 'Long heading'.repeat(30), page: i, blockId: i })),
  })
  const learn = buildLearningContext(doc, 40, { adaptiveReading: true, learningContextChars: 100000 })
  const reread = buildRereadContext(doc, 40, 'block79', { adaptiveReading: true, rereadContextChars: 150000 })
  assert.ok(learn.text.length <= 8000)
  assert.ok(reread.text.length <= 8000)
  assert.ok(learn.aheadIds.every(id => id > 40))
  assert.equal(acceptAheadMarker(`[[AHEAD:B${learn.aheadIds[0]}]]`, { ids: learn.aheadIds }), learn.aheadIds[0])
  assert.equal(acceptAheadMarker('[[AHEAD:B0]]', { ids: learn.aheadIds }), undefined)
})

test('translation centers actual selection before oversized upper context', () => {
  const selected = 'TARGET SELECTION'
  const doc = document([large('upper'), 'x'.repeat(40000) + selected + ' nearby explanatory sentence', large('lower')])
  const result = buildTranslationContext(doc, 1, selected, { translationContextChars: 1000 })
  assert.ok(result.text.length <= 1000, result.text.length)
  assert.match(result.text, /TARGET SELECTION/)
  assert.match(result.text, /nearby explanatory sentence/)
  assert.equal(result.trimmed, true)
  assert.equal(result.selection, selected)
})

test('search paginates bounded excerpts with physical references and local neighbors', () => {
  const doc = document(Array.from({ length: 12 }, (_, i) => `${'x'.repeat(10000)} marker${i} alpha`))
  const first = searchDocument(doc, 'alpha', { anchorId: 4, limit: 2, maxBlockId: 5 })
  assert.equal(first.total, 6)
  assert.equal(first.hits.length, 2)
  assert.equal(first.hits[0].blockId, 4)
  assert.equal(first.hits[0].page, 5)
  assert.match(first.hits[0].ref, /B4/)
  assert.match(first.hits[0].text, /alpha/)
  assert.equal(first.nextOffset, 2)
  const second = searchDocument(doc, 'alpha', { anchorId: 4, limit: 2, offset: first.nextOffset, maxBlockId: 5 })
  assert.ok(second.hits.every(hit => !first.hits.some(previous => previous.blockId === hit.blockId)))
  for (const hit of [...first.hits, ...second.hits]) {
    assert.ok(hit.blockId <= 5)
    assert.ok(hit.text.length <= 1200)
    for (const neighbor of hit.neighbors) {
      assert.ok(neighbor.blockId <= 5)
      assert.ok(Math.abs(neighbor.blockId - hit.blockId) === 1)
      assert.ok(neighbor.text.length <= 350)
    }
  }
  assert.deepEqual(searchDocument(doc, 'notfound').hits, [])
  assert.equal(searchDocument(doc, 'alpha', { offset: 100 }).hasMore, false)
  assert.deepEqual(searchDocument(doc, 'alpha', { maxBlockId: -1 }).hits, [])
})

test('search caps adversarial limits and supports Chinese queries', () => {
  const doc = document(Array.from({ length: 100 }, (_, i) => `第${i}条 贝尔曼方程的定义`))
  const result = searchDocument(doc, '贝尔曼方程', { limit: 100000 })
  assert.equal(result.limit, 20)
  assert.equal(result.hits.length, 20)
  assert.equal(result.total, 100)
})

test('public prompt exports remain compatible and learning prompt integrates older evidence', () => {
  const doc = document(['remote entropy definition', ...Array.from({ length: 10 }, () => large('filler')), 'current'])
  const ask = buildAskPrompt({ doc, mode: 'learn', anchorId: 11, question: 'entropy', options: { adaptiveReading: true } })
  assert.match(ask.prompt, /remote entropy definition/)
  assert.equal(ask.stats.trimmed, true)
  assert.ok(ask.stats.contextChars <= 8000)
  assert.equal(typeof ask.system, 'string')
  const translated = buildTranslatePrompts({ doc, blockId: 0, selection: 'entropy', targetLanguage: 'en' })
  assert.match(translated.prompt, /entropy/)
  assert.ok(renderBlocks(doc, doc.blocks, { maxChars: 300 }).length <= 300)
  assert.ok(bookMap(doc, { maxChars: 100 }).length <= 100)
})

test('outline search finds Unicode titles missing from extracted body and keeps physical destination', () => {
  const doc = document(['garbled text', 'more garbled text', 'last'], {
    toc: [
      { level: 1, title: '贝尔曼方程', blockId: 0, page: 1 },
      { level: 1, title: '未来的贝尔曼方程', blockId: 2, page: 2 },
    ],
  })
  const all = searchDocument(doc, '贝尔曼方程')
  assert.equal(all.total, 2)
  const hit = all.hits.find(item => item.blockId === 0)
  assert.equal(hit.source, 'outline')
  assert.equal(hit.text, '贝尔曼方程')
  assert.equal(hit.page, 2)
  assert.match(hit.ref, /第 2 页.*B0/)
  assert.equal(searchDocument(doc, '贝尔曼方程', { maxBlockId: 0 }).total, 1)
  assert.equal(searchDocument(doc, '贝尔曼方程', { maxBlockId: 0, maxPage: 1 }).total, 0)
})

test('equivalent body and outline hits deduplicate and favor actual body evidence', () => {
  const doc = document(['贝尔曼方程 是价值函数的递归关系'], {
    toc: [{ level: 1, title: '贝尔曼方程', blockId: 0, page: 0 }],
  })
  const result = searchDocument(doc, '贝尔曼方程')
  assert.equal(result.total, 1)
  assert.equal(result.hits[0].source, 'body')
  assert.match(result.hits[0].text, /递归关系/)
})

test('physical maxPage constrains body hits and neighboring locality independently from block ids', () => {
  const doc = document(['alpha first', 'alpha second', 'alpha future'])
  const result = searchDocument(doc, 'alpha', { maxPage: 2 })
  assert.equal(result.total, 2)
  assert.ok(result.hits.every(hit => hit.page <= 2 && hit.neighbors.every(item => item.page <= 2)))
})

test('history preserves physical crop location under per-message budget and rejects invalid crops', () => {
  const text = sanitizeHistory([
    { role: 'user', content: 'x'.repeat(10000), quote: {
      text: 'screenshot', pdfPage: 17, blockId: 8,
      crop: { x: 0.123456789, y: 0.2, width: 0.3, height: 0.4 },
    } },
    { role: 'assistant', content: 'answer' },
  ])
  assert.ok(text.length <= 3020, text.length)
  assert.match(text, /pdfPage=17/)
  assert.match(text, /blockId=8/)
  assert.match(text, /crop=\{"x":0\.123457,"y":0\.2,"width":0\.3,"height":0\.4\}/)
  const invalid = sanitizeHistory([
    { role: 'user', content: 'question', crop: { x: -1, y: 0, width: 1, height: 1 } },
    { role: 'assistant', content: 'answer' },
  ])
  assert.doesNotMatch(invalid, /crop=/)
})

test('custom history and adaptive learning limits reduce initial prompt without splitting turns', () => {
  const history = Array.from({ length: 5 }, (_, i) => [
    { role: 'user', content: `QUESTION${i} ${'x'.repeat(300)}` },
    { role: 'assistant', content: `ANSWER${i} ${'x'.repeat(300)}` },
  ]).flat()
  const transcript = sanitizeHistory(history, 1000)
  assert.ok(transcript.length <= 1000)
  assert.match(transcript, /QUESTION4/)
  assert.match(transcript, /ANSWER4/)
  assert.doesNotMatch(transcript, /QUESTION3/)
  assert.equal(sanitizeHistory(history, 0), '')
  const ask = buildAskPrompt({ doc: document([large('anchor')]), mode: 'learn', anchorId: 0,
    question: 'explain', history, options: { adaptiveReading: true, learningContextChars: 4000, historyContextChars: 1000 } })
  assert.ok(ask.stats.contextChars <= 4000)
  assert.ok(ask.stats.historyChars <= 1000)
})
