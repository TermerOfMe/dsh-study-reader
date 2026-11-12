import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

// Exercise the shipped pure functions, not a copied implementation or a DOM
// stand-in. Match each closing brace at its declaration indentation so the
// adjacent geometry/rendering code cannot accidentally enter the VM.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const declarations = ['searchTextIndex', 'searchTextMatches'].map(name => {
  const pattern = new RegExp(`^([ \\t]*)function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\1\\}`, 'gm')
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, `expected one extractable ${name} declaration`)
  return matches[0][0]
})
const functions = vm.runInNewContext(
  `${declarations.join('\n')}\n({ searchTextIndex, searchTextMatches })`,
  Object.create(null), { filename: 'client.js:search-position-policy', timeout: 1000 },
)
// VM objects have different prototypes; compare their plain serializable data.
const index = value => JSON.parse(JSON.stringify(functions.searchTextIndex(value)))
const find = (...args) => JSON.parse(JSON.stringify(functions.searchTextMatches(...args)))
const slices = (text, result) => result.matches.map(({ start, end }) => {
  assert.ok(Number.isInteger(start) && Number.isInteger(end))
  assert.ok(start >= 0 && start < end && end <= text.length, 'valid half-open source interval')
  return text.slice(start, end)
})

test('precomposed and combining accents map to complete source clusters', () => {
  const text = 'cafe\u0301 / café'
  const result = find(text, 'CAFÉ')
  assert.deepEqual(slices(text, result), ['cafe\u0301', 'café'])
  assert.deepEqual(index('e\u0301x'), { text: 'éx', starts: [0, 2], ends: [2, 3] })
})

 test('UTF-16 offsets preserve astral characters before and inside a match', () => {
  const text = '😀 pre 𝄞Target😀 end'
  const query = '𝄞target😀'
  const result = find(text, query)
  const start = text.indexOf('𝄞')
  assert.deepEqual(result, { matches: [{ start, end: start + query.length }], active: 0 })
  assert.deepEqual(slices(text, result), ['𝄞Target😀'])
  const mapped = index('😀A')
  assert.deepEqual(mapped, { text: '😀a', starts: [0, 0, 2], ends: [2, 2, 3] })
})

test('NFKC ligatures expand into mapped units of the same original character', () => {
  const text = 'The oﬃce ﬁle has ﬂow.'
  const result = find(text, 'office file')
  assert.deepEqual(slices(text, result), ['oﬃce ﬁle'])
  assert.equal(result.active, 0)
  assert.deepEqual(index('ﬃ'), { text: 'ffi', starts: [0, 0, 0], ends: [1, 1, 1] })
  assert.deepEqual(slices(text, find(text, 'fi')), ['ﬃ', 'ﬁ'])
})

test('fullwidth query and source normalize symmetrically with precise source bounds', () => {
  const text = 'prefix ＡＢＣ１２３ suffix ABC123!'
  assert.deepEqual(slices(text, find(text, 'abc123')), ['ＡＢＣ１２３', 'ABC123'])
  assert.deepEqual(slices(text, find(text, 'ａｂｃ１２３')), ['ＡＢＣ１２３', 'ABC123'])
})

test('whitespace and wrapped line fragments disappear only from searchable text', () => {
  const text = 'before alpha \r\n\t beta\u00a0gamma after'
  const result = find(text, 'ALPHA beta gamma')
  assert.deepEqual(slices(text, result), ['alpha \r\n\t beta\u00a0gamma'])
  assert.equal(index(slices(text, result)[0]).text, 'alphabetagamma')
})

test('CJK queries bridge line and fragment separators without swallowing adjacent text', () => {
  const text = '前文：深 度\n学\t习 方法。后文'
  const result = find(text, '深度学习方法')
  assert.deepEqual(slices(text, result), ['深 度\n学\t习 方法'])
  assert.equal(text[result.matches[0].start - 1], '：')
  assert.equal(text[result.matches[0].end], '。')
})

test('case folding length expansion maps dotted capital I to its full original code point', () => {
  const text = '😀İSTANBUL / istanbul'
  assert.deepEqual(index('İx'), { text: 'i\u0307x', starts: [0, 0, 1], ends: [1, 1, 2] })
  const result = find(text, 'i\u0307stanbul')
  assert.deepEqual(result, { matches: [{ start: 2, end: 10 }], active: 0 })
  assert.deepEqual(slices(text, result), ['İSTANBUL'])
  assert.deepEqual(slices(text, find(text, 'İSTANBUL')), ['İSTANBUL'])
  // A partial normalized hit still maps to the whole original character.
  assert.deepEqual(slices(text, find(text, '\u0307s')), ['İS'])
})

test('soft hyphens disappear for matching but are retained inside mapped source slices', () => {
  const text = 'x co\u00adoper\u00adation y cooperation'
  const result = find(text, 'cooperation')
  assert.deepEqual(slices(text, result), ['co\u00adoper\u00adation', 'cooperation'])
  assert.deepEqual(slices(text, find(text, 'co\u00adoperation')), slices(text, result))
  assert.deepEqual(index('\u00adA\u00ad'), { text: 'a', starts: [1], ends: [2] })
})

test('repeated queries use surrounding context to select the correct occurrence', () => {
  const text = 'red needle apple; blue needle berry; green needle citrus'
  const result = find(text, 'needle', 'blue needle berry')
  const starts = [text.indexOf('needle'), text.indexOf('needle', 5), text.lastIndexOf('needle')]
  assert.deepEqual(result.matches.map(match => match.start), starts)
  assert.deepEqual(slices(text, result), ['needle', 'needle', 'needle'])
  assert.equal(result.active, 1)
  assert.equal(find(text, 'needle', 'green needle citrus').active, 2)
  assert.equal(find(text, 'needle', 'red needle apple').active, 0)
})

test('context normalization handles ligatures, fullwidth letters and whitespace', () => {
  const text = 'wrong ﬁle red; correct ＦＩＬＥ\n blue; other file green'
  const result = find(text, 'file', 'correct file blue')
  assert.deepEqual(slices(text, result), ['ﬁle', 'ＦＩＬＥ', 'file'])
  assert.equal(result.active, 1)
  assert.equal(find(text, 'file', 'CORRECT ＦＩＬＥ\tBLUE').active, 1)
})

test('missing or unrelated context chooses the first equal-score occurrence', () => {
  const text = 'first hit / second hit / third hit'
  assert.equal(find(text, 'hit').active, 0)
  assert.equal(find(text, 'hit', 'unrelated context without the query').active, 0)
  assert.deepEqual(slices(text, find(text, 'hit')), ['hit', 'hit', 'hit'])
})

test('empty query, empty text and absent matches return no active occurrence', () => {
  for (const text of ['', null, undefined, ' \t\n\u00ad', 'actual text']) {
    for (const query of ['', null, undefined, ' \n\t\u00ad']) {
      assert.deepEqual(find(text, query), { matches: [], active: -1 })
    }
  }
  for (const text of ['', null, undefined, ' \n\u00ad', 'actual text']) {
    assert.deepEqual(find(text, 'missing'), { matches: [], active: -1 })
  }
  assert.deepEqual(index(null), { text: '', starts: [], ends: [] })
})

test('dense repeated matches are bounded at 2000 and retain valid source offsets', () => {
  const text = ' ﬁ\n'.repeat(2100)
  const result = find(text, 'fi')
  assert.equal(result.matches.length, 2000)
  assert.equal(result.active, 0)
  assert.ok(slices(text, result).every(slice => slice === 'ﬁ'))
  assert.deepEqual(result.matches[0], { start: 1, end: 2 })
  assert.deepEqual(result.matches.at(-1), { start: 1999 * 3 + 1, end: 1999 * 3 + 2 })
  const belowLimit = find('ab '.repeat(1999), 'ab')
  assert.equal(belowLimit.matches.length, 1999)
})

test('a match spanning joined source fragments maps both endpoints into original source', () => {
  const fragments = ['heading 😀 ', 'inter', 'na\n', 'tional', ' co\u00ad', 'oper', 'ation', ' tail']
  const text = fragments.join('')
  const result = find(text, 'international cooperation')
  const start = fragments[0].length
  const end = text.length - fragments.at(-1).length
  assert.deepEqual(result, { matches: [{ start, end }], active: 0 })
  assert.deepEqual(slices(text, result), ['interna\ntional co\u00adoperation'])
  assert.equal(index(text.slice(start, end)).text, 'internationalcooperation')
})

test('leading and trailing whitespace in source and query never inflate mapped bounds', () => {
  const text = ' \t\n\u00ad Ｔarget \r\n\u00ad'
  const result = find(text, '\n\t target \u00ad ')
  assert.deepEqual(slices(text, result), ['Ｔarget'])
  const start = text.indexOf('Ｔ')
  assert.deepEqual(result, { matches: [{ start, end: start + 'Ｔarget'.length }], active: 0 })
  assert.deepEqual(index(' \t A\nB \u00ad'), { text: 'ab', starts: [3, 5], ends: [4, 6] })
})
