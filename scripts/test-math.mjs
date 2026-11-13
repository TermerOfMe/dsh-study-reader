import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import katex from 'katex'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const extract = name => {
  const pattern = new RegExp(`^([ \\t]*)function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\1\\}`, 'gm')
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, `one actual client ${name} function`)
  return matches[0][0]
}
const api = vm.runInNewContext(`${extract('protectMarkdownMath')}\n${extract('renderMathHtml')}\n({protectMarkdownMath, renderMathHtml})`, Object.create(null))
const protect = text => JSON.parse(JSON.stringify(api.protectMarkdownMath(text)))
const tex = text => protect(text).formulas.map(item => item.tex)

test('all four delimiters preserve TeX and classify display vs inline', () => {
  const text = String.raw`A \(a_i^2\) B $b_j$ C \[c=\frac{1}{2}\] D $$d=4$$`
  const result = protect(text)
  assert.deepEqual(result.formulas.map(({tex,display}) => ({tex,display})), [
    {tex:'a_i^2',display:false},{tex:'b_j',display:false},{tex:String.raw`c=\frac{1}{2}`,display:true},{tex:'d=4',display:true},
  ])
  assert.match(result.text, /A .* B .* C \n.*\n D \n/)
})

test('tagged Bellman expectation equation renders real KaTeX display and MathML', () => {
  const equation = String.raw`v_\pi(s)=\sum_a\pi(a\mid s)\sum_{s',r}p(s',r\mid s,a)\left[r+\gamma v_\pi(s')\right]\tag{3.14}`
  const result = protect('\\[\n' + equation + '\n\\]')
  assert.equal(result.formulas.length, 1)
  const html = api.renderMathHtml(katex, result.formulas[0].tex, true)
  assert.match(html, /katex-display/)
  assert.match(html, /<math/)
  assert.match(html, /class="(?:katex-)?tag"/)
  assert.match(html, /3\.14/)
  assert.doesNotMatch(html, /katex-error/)
})

test('reported policy gradient equation 4.17 renders with its tag', () => {
  const equation = String.raw`\nabla \bar{R}_{\theta} \approx \frac{1}{N} \sum_{n=1}^{N} \sum_{t=1}^{T_n} \left(R(\tau^{n})-b\right) \nabla \log p_{\theta}\!\left(a_t^{n}\mid s_t^{n}\right). \tag{4.17}`
  const [{ tex: value, display }] = protect('\\[\n' + equation + '\n\\]').formulas
  assert.equal(display, true)
  const html = api.renderMathHtml(katex, value, display)
  assert.match(html, /katex-display/)
  assert.match(html, /<math/)
  assert.match(html, /4\.17/)
  assert.doesNotMatch(html, /katex-error/)
})

test('multiline aligned matrices retain newlines, ampersands and row separators', () => {
  const text = String.raw`$$\begin{aligned}
a &= b+c \\
x &= \begin{pmatrix}1&2\\3&4\end{pmatrix}
\end{aligned}$$`
  const [{tex: value}] = protect(text).formulas
  assert.ok(value.includes('\n'))
  assert.match(api.renderMathHtml(katex, value, true), /katex-display/)
})

test('backtick and tilde fences plus single and multiple backtick spans are untouched', () => {
  const text = '```tex\n$x$\\[y\\]\n```\n~~~\n$$z$$\n~~~\n`$a$` ``\\(b\\)`` and $real$'
  assert.deepEqual(tex(text), ['real'])
  assert.ok(protect(text).text.includes('`$a$`'))
})

test('escaped delimiters, currency and unclosed streaming input stay readable', () => {
  for (const input of [String.raw`\$20 and \$30`, '$20 and $30', '$10.00', String.raw`\[x`, String.raw`\(x`, '$x', '$$x', '$ x $']) {
    assert.deepEqual(tex(input), [], input)
    assert.equal(protect(input).text, input)
  }
  assert.deepEqual(tex(String.raw`$x+\$y$`), [String.raw`x+\$y`])
})

test('display parsing protects Markdown syntax and leaves references outside intact', () => {
  const result = protect(String.raw`**Value** $x_i * y$ [B12] \[\left|a\right|=b\tag{7}\]`)
  assert.deepEqual(result.formulas.map(item => item.tex), ['x_i * y', String.raw`\left|a\right|=b\tag{7}`])
  assert.ok(result.text.includes('**Value**'))
  assert.ok(result.text.includes('[B12]'))
})

test('private marker collisions cannot replace user text with formulas', () => {
  const result = protect('\uE000DSRMATH:0\uE001 $x$')
  assert.equal(result.prefix, '\uE000DSRMATH::')
  assert.ok(result.text.includes('\uE000DSRMATH:0\uE001'))
  assert.equal(result.formulas[0].tex, 'x')
})

test('link destinations containing dollar characters are not formulas', () => {
  assert.deepEqual(tex('[reference](https://example.org/$x$/paper) and $y$'), ['y'])
})

test('untrusted HTML commands and unsafe links cannot become executable markup', () => {
  for (const value of [String.raw`\href{javascript:alert(1)}{click}`, String.raw`\htmlClass{evil}{x}`, String.raw`\includegraphics{https://example.org/tracker}`]) {
    let html = ''
    try { html = api.renderMathHtml(katex, value, false) } catch { /* fallback is raw React text */ }
    assert.doesNotMatch(html, /href="javascript:|class="evil"|<img\b|<script\b/)
  }
})

test('macros cannot leak across equations and malformed TeX triggers raw fallback', () => {
  api.renderMathHtml(katex, String.raw`\gdef\myprivate{x}\myprivate`, false)
  assert.throws(() => api.renderMathHtml(katex, String.raw`\myprivate`, false))
  assert.throws(() => api.renderMathHtml(katex, String.raw`\frac{`, false))
  assert.throws(() => api.renderMathHtml(katex, String.raw`\def\a{\a}\a`, false))
})


// Run the actual Markdown function with inert hooks to inspect its React tree.
// KaTeX rendering itself is tested above with the real engine.
const markdownSource = source.slice(source.indexOf('    const CitationContext ='), source.indexOf('    // ── small controls'))
const h = (type, props, ...children) => ({type, props: props ?? {}, children})
const fakeReact = { createContext: () => ({Provider: 'context-provider'}), memo: fn => fn }
const markdown = vm.runInNewContext(markdownSource + '\nMarkdown', {
  React: fakeReact, h, cls: (...values) => values.filter(Boolean).join(' '),
  useMemo: fn => fn(), useState: value => [value, () => {}], useEffect: () => {},
  vendorUrl: value => '/api/dsh-study' + value,
})
function walk(tree) {
  if (Array.isArray(tree)) return tree.flatMap(walk)
  if (tree === null || typeof tree !== 'object') return []
  return [tree, ...walk(tree.children)]
}

test('actual Markdown renders display math, inline emphasis, table cells and citation nodes', () => {
  const input = '**Energy $E_i$** [B12]\n\n\\[a=b\\tag{9}\\]\n\n| Quantity | Meaning |\n| --- | --- |\n| $x\\mid y$ | value |'
  const nodes = walk(markdown({text: input}))
  const formulas = nodes.filter(node => typeof node.type === 'function' && node.type.name === 'MathFormula')
  assert.equal(formulas.length, 3)
  assert.equal(formulas.filter(node => node.props.formula.display).length, 1)
  assert.ok(nodes.some(node => node.type === 'strong'))
  assert.ok(nodes.some(node => node.type === 'table'))
  assert.ok(nodes.some(node => typeof node.type === 'function' && node.type.name === 'Citation'))
  assert.equal(nodes.filter(node => node.type === 'link').length, 1)
  assert.ok(nodes.some(node => node.props.href === '/api/dsh-study/vendor/katex/katex.min.css'))
})

test('actual Markdown preserves code fences and renders math in links without URL corruption', () => {
  const input = '~~~tex\n$x$\n~~~\n\n[$y$](https://example.org/$raw$/)'
  const nodes = walk(markdown({text: input}))
  assert.equal(nodes.filter(node => typeof node.type === 'function' && node.type.name === 'MathFormula').length, 1)
  assert.ok(nodes.some(node => node.type === 'code' && node.children[0] === '$x$'))
  assert.ok(nodes.some(node => node.type === 'a' && node.props.href === 'https://example.org/$raw$/'))
})

test('numeric equations and multiline backslash inline equations remain valid', () => {
  assert.deepEqual(tex('$2 x + 1$'), ['2 x + 1'])
  assert.deepEqual(tex('\\(a +\n b\\)'), ['a +\n b'])
})
