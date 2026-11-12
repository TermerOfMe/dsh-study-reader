import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEvidence } from '../lib/evidence.js'
import { buildAskPrompt, acceptAheadMarker } from '../lib/context.js'

const pdf = () => ({ kind: 'pdf', title: 'Evidence',
  pages: [{ label: '第 1 页', pdfPage: 1 }, { label: '第 4 页', pdfPage: 4 }],
  blocks: [{ id: 0, page: 0, text: 'Definition stated here.' }, { id: 1, page: 1, text: 'A later result.' }],
  toc: [], stats: { chars: 40 } })

test('block references resolve the actual physical page after empty pages were dropped', () => {
  const doc = pdf(), original = structuredClone(doc)
  const value = resolveEvidence(doc, '[B1]', { pageCount: 8 })
  assert.equal(value.pdfPage, 4)
  assert.equal(value.blockId, 1)
  assert.equal(value.quote, 'A later result.')
  assert.equal(value.label, '第 4 页 · B1')
  assert.equal(value.textStatus, 'available')
  assert.deepEqual(doc, original)
  assert.equal(resolveEvidence(doc, '[第 4 页]').quote, value.quote)
  assert.equal(resolveEvidence(doc, '[第 2 页]'), null)
})

test('invalid syntax, unknown IDs, invalid counts and physical ranges are rejected', () => {
  const doc = pdf()
  for (const ref of ['B0', '[b0]', '[B01]', '[B-1]', '[B1.0]', '[B2]', '[第 0 页]', '[第 01 页]',
    '[第 2 节]', '[第 1 页] trailing', '[[AHEAD:B1]]', '[B9007199254740992]', '[第\n1 页]', null, {}, 'x'.repeat(65)]) {
    assert.equal(resolveEvidence(doc, ref), null, String(ref))
  }
  for (const pageCount of [0, -1, '4', 1.5, Infinity, NaN]) assert.equal(resolveEvidence(doc, '[B0]', { pageCount }), null)
  assert.equal(resolveEvidence(doc, '[B1]', { pageCount: 3 }), null)
  assert.equal(resolveEvidence(doc, '[第 4 页]', { pageCount: 3 }), null)
  assert.equal(resolveEvidence(doc, '[第 9 页]', { pageCount: 8 }), null)
  assert.equal(resolveEvidence({}, '[B0]'), null)
})

test('renderer-confirmed pages without extracted text resolve without borrowing neighboring text', () => {
  const doc = pdf()
  const page = resolveEvidence(doc, '[第 3 页]', { pageCount: 8 })
  assert.equal(page.pdfPage, 3)
  assert.equal(page.quote, '')
  assert.equal(page.blockId, null)
  assert.equal(page.textStatus, 'no-text')
  assert.deepEqual(page.blocks, [])
  const pending = { kind: 'pdf', pages: [], blocks: [] }
  assert.equal(resolveEvidence(pending, '[第 2 页]'), null)
  assert.equal(resolveEvidence(pending, '[第 2 页]', { pageCount: 2 }).textStatus, 'no-text')
  pending.pages.push({ label: '第 1 页', pdfPage: 1 })
  pending.blocks.push({ id: 0, page: 0, text: '（此 PDF 没有可提取的文本层，可能是扫描件。请切换到“原貌”查看原文件。）' })
  assert.equal(resolveEvidence(pending, '[B0]').textStatus, 'no-text')
})

test('bounded previews disclose omitted blocks and text', () => {
  const doc = pdf()
  doc.blocks = Array.from({ length: 100 }, (_, id) => ({ id, page: 0, text: `START${id} ` + 'x'.repeat(10000) }))
  const page = resolveEvidence(doc, '[第 1 页]')
  assert.ok(page.quote.length <= 2400)
  assert.ok(page.blocks.length <= 6)
  assert.ok(page.blocks.reduce((sum, item) => sum + item.text.length, 0) <= 6000)
  assert.ok(page.blocks.every(item => item.text.length <= 1200 && item.truncated))
  assert.equal(page.truncated, true)
  assert.equal(resolveEvidence(doc, '[B20]').blocks[0].blockId, 20)
})

test('ambiguous duplicate IDs and page mappings never pick an arbitrary source', () => {
  const doc = pdf()
  doc.blocks.push({ id: 1, page: 0, text: 'Conflicting identity' })
  assert.equal(resolveEvidence(doc, '[B1]'), null)
  doc.pages.push({ label: '第 4 页', pdfPage: 4 })
  assert.equal(resolveEvidence(doc, '[第 4 页]', { pageCount: 8 }), null)
  doc.blocks.push({ id: 2, page: 99, text: 'Bad location' })
  assert.equal(resolveEvidence(doc, '[B2]'), null)
})

test('Word logical units remain text sources without guessed physical mapping', () => {
  const doc = { kind: 'docx', pages: [{ label: '第 1 节' }, { label: '第 2 页' }],
    blocks: [{ id: 0, page: 0, text: 'Word paragraph' }, { id: 1, page: 1, text: 'Not a physical-page proof' }] }
  assert.equal(resolveEvidence(doc, '[B0]', { pageCount: 20 }).pdfPage, null)
  assert.equal(resolveEvidence(doc, '[B1]', { pageCount: 20 }).pdfPage, null)
  assert.equal(resolveEvidence(doc, '[第 2 页]'), null)
  const physical = resolveEvidence(doc, '[第 2 页]', { pageCount: 20 })
  assert.equal(physical.textStatus, 'no-text')
  assert.equal(physical.quote, '')
  doc.pages[0].pdfPage = 7
  assert.equal(resolveEvidence(doc, '[B0]', { pageCount: 20 }).pdfPage, 7)
})

test('slide references use original labels after empty slides were removed', () => {
  const doc = { kind: 'pptx', pages: [{ label: '第 4 张' }], blocks: [{ id: 0, page: 0, text: 'Slide four' }] }
  assert.equal(resolveEvidence(doc, '[第 1 张]'), null)
  assert.equal(resolveEvidence(doc, '[第 4 张]').quote, 'Slide four')
  assert.equal(resolveEvidence(doc, '[第 4 张]', { pageCount: 8 }).pdfPage, null)
  doc.pages[0].pdfPage = 5
  assert.equal(resolveEvidence(doc, '[第 4 张]', { pageCount: 8 }).pdfPage, 5)
  assert.equal(resolveEvidence(doc, '[第 5 页]', { pageCount: 8 }).quote, 'Slide four')
})

test('PDF label fallback is physical only for PDF; sourcePage and array positions are not assumed', () => {
  const doc = { kind: 'pdf', pages: [{ label: '第 9 页', sourcePage: 1 }], blocks: [{ id: 0, page: 0, text: 'Page nine' }] }
  assert.equal(resolveEvidence(doc, '[B0]').pdfPage, 9)
  assert.equal(resolveEvidence(doc, '[第 1 页]'), null)
  assert.equal(resolveEvidence(doc, '[第 9 页]').pdfPage, 9)
})

test('answer prompts distinguish inference and source location while preserving learning policy and AHEAD', () => {
  const doc = pdf()
  for (const mode of ['learn', 'reread']) {
    const prompt = buildAskPrompt({ doc, mode, anchorId: 0, question: 'Why?', history: [], options: {} })
    assert.match(prompt.system, /关键结论/)
    assert.match(prompt.system, /原文明确指出/)
    assert.match(prompt.system, /可以推断/)
    assert.match(prompt.system, /不得编造/)
    assert.match(prompt.system, /\[B12\]/)
    assert.match(prompt.system, /\[第 2 张\]/)
    assert.match(prompt.system, /不代表结论已经过事实核验/)
    assert.equal(prompt.stats.systemChars, prompt.system.length)
    if (mode === 'learn') {
      assert.match(prompt.system, /标记必须是回答的第一行/)
      assert.match(prompt.system, /不要直接引用或泄露/)
      assert.equal(acceptAheadMarker('[[AHEAD:B1]]', prompt.ahead), 1)
      assert.equal(acceptAheadMarker('[[AHEAD:B0]]', prompt.ahead), undefined)
    }
  }
})
