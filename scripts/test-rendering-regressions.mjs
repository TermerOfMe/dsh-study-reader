import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { resolveEvidence } from '../lib/evidence.js'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const declaration = source.match(/^    const INLINE_RE = .+$/m)?.[0]
assert.ok(declaration)
const pattern = vm.runInNewContext(declaration + '\nINLINE_RE')
const tokens = text => [...text.matchAll(new RegExp(pattern.source, 'g'))].map(match => match[0])

test('actual inline tokenizer recognizes range forms accepted by the source resolver', () => {
  const doc = { kind: 'pdf', pages: [{ pdfPage: 1 }], blocks: Array.from({ length: 7 }, (_, index) => ({ id: 169 + index, page: 0, text: 'source' })) }
  for (const token of ['[B169–B175]', '[B169-B175]', '[B169—175]', '[B169 − B175]', '[B169~175]', '[B169～B175]']) {
    assert.deepEqual(tokens('Before ' + token + ' after'), [token])
    assert.ok(resolveEvidence(doc, token))
  }
})

test('tokenizer retains single citations and protects inline code and link targets', () => {
  assert.deepEqual(tokens('[B169] [第 2 页] [第 3 张]'), ['[B169]', '[第 2 页]', '[第 3 张]'])
  assert.deepEqual(tokens('`[B169–B175]` [source](https://example.org/[B169–B175])'), ['`[B169–B175]`', '[source](https://example.org/[B169–B175])'])
  assert.deepEqual(tokens('[B169–\nB175] [B169–]'), [])
})

test('translation output uses the shared math renderer and copies the original text', () => {
  const card = source.slice(source.indexOf('    const TranslationCard ='), source.indexOf('    function TranslationBody('))
  assert.match(card, /className: 'dsr-trans-result' }, h\(Markdown, \{ text: item.text \}\)/)
  assert.match(card, /h\(CopyButton, \{ text: item.text,/)
  assert.doesNotMatch(source.match(/\.dsr-trans-result\{[^}]+\}/)[0], /white-space:pre-wrap/)
})
