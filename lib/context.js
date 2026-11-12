/**
 * Context assembly for context-aware translation and the two Q&A modes.
 *
 * Learning mode is deliberately asymmetric: the model may see a small window
 * of what comes next, but only to decide whether the reader should continue
 * before asking for the full explanation. Rereading mode may use the entire
 * document and is encouraged to connect distant sections.
 */

const LATIN_RE = /[A-Za-z][A-Za-z0-9'’-]{1,}/g
const CJK_RUN_RE = /[\u3400-\u9fff]+/g
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were',
  'be', 'been', 'it', 'this', 'that', 'these', 'those', 'as', 'by', 'from', 'at', 'which', 'what',
  'how', 'why', 'can', 'could', 'should', 'would', 'do', 'does', 'did', 'not', 'we', 'you', 'they',
  'he', 'she', 'i', 'but', 'if', 'then', 'than', 'so', 'about', 'into', 'document', 'text', 'does',
])

export const LANGUAGE_NAMES = Object.freeze({
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  ar: 'العربية',
  pt: 'Português',
  it: 'Italiano',
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function pageLabelOf(doc, pageIndex) {
  const page = doc.pages?.[pageIndex]
  return page?.label ?? `第 ${Number(pageIndex) + 1} 页`
}

export function blockRef(doc, block) {
  return `${pageLabelOf(doc, block.page)} · B${block.id}`
}

export function findBlock(doc, blockId) {
  if (!Number.isInteger(blockId) || blockId < 0 || blockId >= doc.blocks.length) return undefined
  return doc.blocks[blockId]
}

function nearestHeading(doc, anchor) {
  for (let index = anchor; index >= 0; index -= 1) {
    const block = doc.blocks[index]
    if (block?.type === 'heading') return block
  }
  return undefined
}

const OMITTED = '…（已截断）'

function bounded(text, maxChars, needle = '') {
  const value = String(text ?? '')
  const limit = Math.max(0, Math.floor(maxChars))
  if (value.length <= limit) return value
  if (limit <= OMITTED.length * 2) return value.slice(0, limit)
  const room = limit - OMITTED.length * 2
  const match = needle ? value.toLowerCase().indexOf(String(needle).toLowerCase()) : -1
  const start = match < 0 ? 0 : Math.max(0, Math.min(value.length - room, match - Math.floor(room / 3)))
  return `${start > 0 ? OMITTED : ''}${value.slice(start, start + room)}${OMITTED}`
}

function integer(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? clamp(Math.floor(number), min, max) : fallback
}

function outlineText(doc, upToBlock = Number.POSITIVE_INFINITY, maxChars = 4000) {
  const items = (doc.toc ?? []).filter(item => item.blockId <= upToBlock)
  if (items.length === 0) return '（无标题）'
  return bounded(items.map(item => `${'  '.repeat(integer(item.level, 1, 1, 6) - 1)}- ${bounded(item.title, 180)}（${bounded(pageLabelOf(doc, item.page), 60)} · B${item.blockId}）`).join('\n'), maxChars)
}

/** Bounded real outline, suitable for discovering sections without loading prose. */
export function bookMap(doc, options = {}) {
  const lines = []
  let chapter = null
  let sections = 0
  for (const item of doc.toc ?? []) {
    if (lines.length >= 160) break
    if (item.level === 1) {
      chapter = item
      sections = 0
      lines.push(`- ${bounded(item.title, 180)}（${bounded(pageLabelOf(doc, item.page), 60)}）`)
    } else if (item.level === 2 && chapter !== null && sections < 6) {
      sections += 1
      lines.push(`  - ${bounded(item.title, 180)}`)
    }
  }
  return bounded(lines.length > 0 ? lines.join('\n') : '（无目录）', integer(options.maxChars, 6000, 100, 12000))
}

/** Render positional references and text. maxChars includes labels and omission markers. */
export function renderBlocks(doc, blocks, options = {}) {
  const lines = []
  let page = -1
  for (const block of blocks) {
    if (page !== block.page) {
      page = block.page
      lines.push(`\n--- ${bounded(pageLabelOf(doc, page), 60)} ---`)
    }
    const prefix = `[B${block.id}]`
    if (block.type === 'heading') lines.push(`${prefix} ## ${block.text}`)
    else if (block.type === 'list-item') lines.push(`${prefix} - ${block.text}`)
    else if (block.type === 'table') lines.push(`${prefix} [表格]\n${block.text}`)
    else if (block.type === 'note') lines.push(`${prefix} [演讲者备注] ${block.text}`)
    else if (block.type === 'code') lines.push(`${prefix} [代码]\n${block.text}`)
    else lines.push(`${prefix} ${block.text}`)
  }
  const text = lines.join('\n')
  return Number.isFinite(options.maxChars) ? bounded(text, options.maxChars) : text
}

function makeTermScores(query) {
  const scores = new Map()
  const input = String(query ?? '').slice(0, 4000)
  for (const match of input.toLowerCase().matchAll(LATIN_RE)) {
    const term = match[0]
    if (term.length < 2 || STOP_WORDS.has(term)) continue
    scores.set(term, 1)
  }
  for (const match of input.matchAll(CJK_RUN_RE)) {
    const run = match[0]
    if (run.length === 1) scores.set(run, 0.5)
    else for (let index = 0; index < run.length - 1; index += 1) scores.set(run.slice(index, index + 2), 1.5)
  }
  return scores
}

function rankedBlocks(doc, query, anchorId, maxBlockId = doc.blocks.length - 1, sourceBlocks = doc.blocks) {
  const terms = makeTermScores(query)
  if (terms.size === 0) return []
  const blocks = sourceBlocks.filter(block => block.id <= maxBlockId)
  const rows = blocks.map(block => ({ block, lower: block.text.toLowerCase(), matches: [] }))
  for (const [term, weight] of terms) {
    const matches = rows.filter(row => row.lower.includes(term))
    const idf = Math.log(1 + (rows.length + 1) / (matches.length + 1))
    for (const row of matches) row.matches.push({ term, weight: weight * idf })
  }
  return rows.filter(row => row.matches.length > 0).map(row => ({
    block: row.block,
    needle: row.matches.reduce((best, item) => item.weight > best.weight ? item : best).term,
    score: row.matches.reduce((sum, item) => sum + item.weight, 0)
      * (row.block.type === 'heading' ? 1.15 : 1)
      + 0.2 / (1 + Math.abs(row.block.id - anchorId)),
  })).sort((a, b) => b.score - a.score || Math.abs(a.block.id - anchorId) - Math.abs(b.block.id - anchorId) || a.block.id - b.block.id)
}

function pageNumber(doc, block) {
  return Number(doc.pages?.[block.page]?.pdfPage) || block.page + 1
}

/**
 * Search extracted body and outline titles. page is 1-based; pageIndex/blockId are 0-based.
 * Hits are relevance ordered and deduplicated by block; source is body or outline.
 * maxBlockId and physical maxPage constrain hits and +/-1 neighbor excerpts.
 * Results are bounded (20 hits, 1200 chars/hit, 350 chars/neighbor) and paged.
 */
export function searchDocument(doc, query, { anchorId = 0, maxBlockId, maxPage = Infinity, limit = 6, offset = 0 } = {}) {
  const max = integer(maxBlockId, doc.blocks.length - 1, -1, doc.blocks.length - 1)
  const pageCap = integer(maxPage, Infinity, 0, Number.MAX_SAFE_INTEGER)
  const anchor = integer(anchorId, 0, 0, Math.max(0, doc.blocks.length - 1))
  const count = integer(limit, 6, 1, 20)
  const skip = integer(offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const outlines = (doc.toc ?? []).filter(item => Number.isInteger(item.blockId)
    && item.blockId >= 0 && item.blockId <= max && typeof item.title === 'string'
    && Number.isInteger(item.page) && item.page >= 0 && item.page < doc.pages.length)
    .map(item => ({ id: item.blockId, page: item.page, type: 'heading', text: item.title, source: 'outline' }))
  const combined = rankedBlocks(doc, query, anchor, max, [...doc.blocks, ...outlines].filter(block => pageNumber(doc, block) <= pageCap))
  const bestByBlock = new Map()
  for (const row of combined) {
    const previous = bestByBlock.get(row.block.id)
    if (!previous || (previous.block.source === 'outline' && row.block.source !== 'outline' && row.score >= previous.score / 1.3)) bestByBlock.set(row.block.id, row)
  }
  const ranked = [...bestByBlock.values()].sort((a, b) => b.score - a.score || Math.abs(a.block.id - anchor) - Math.abs(b.block.id - anchor) || a.block.id - b.block.id)
  const excerpt = (block, size, needle = '') => ({
    blockId: block.id, page: pageNumber(doc, block), pageIndex: block.page,
    ref: bounded(blockRef(doc, block), 100), text: bounded(block.text, size, needle),
    truncated: block.text.length > size,
  })
  const hits = ranked.slice(skip, skip + count).map(({ block, score, needle }) => ({
    ...excerpt(block, 1200, needle), score, source: block.source ?? 'body',
    neighbors: [doc.blocks[block.id - 1], doc.blocks[block.id + 1]]
      .filter(neighbor => neighbor !== undefined && neighbor.id <= max && pageNumber(doc, neighbor) <= pageCap)
      .map(neighbor => excerpt(neighbor, 350)),
  }))
  const hasMore = skip + hits.length < ranked.length
  return { hits, total: ranked.length, offset: skip, limit: count, hasMore, nextOffset: hasMore ? skip + hits.length : null }
}

function neighborhood(doc, anchorId, radius, maxBlockId = doc.blocks.length - 1) {
  return doc.blocks.slice(Math.max(0, anchorId - radius), Math.min(maxBlockId, anchorId + radius) + 1)
}

function contextHeader(doc, anchor, options, maxBlockId, budget) {
  const directoryBudget = Math.min(options.adaptiveReading === true ? 1000 : 3000, Math.floor(budget / 4))
  const heading = nearestHeading(doc, anchor)
  return [
    '# 文档',
    `标题：${bounded(doc.title, 240)}`,
    `类型：${bounded(doc.kindLabel ?? doc.kind, 40)}　总${doc.pages.length}个阅读单元　共${doc.stats?.chars ?? 0}字`,
    '# 全书章节概览（仅结构，非正文证据）',
    bookMap(doc, { maxChars: Math.floor(directoryBudget / 2) }),
    '# 目录（可定位，未列出的条目已省略）',
    outlineText(doc, maxBlockId, Math.floor(directoryBudget / 2)),
    '# 用户当前位置',
    `位置：${bounded(blockRef(doc, doc.blocks[anchor]), 100)}${heading && heading.id !== anchor ? `，所在小节「${bounded(heading.text, 160)}」` : ''}`,
  ].join('\n')
}

/** Fit priority-ordered blocks, then display selected evidence in document order. */
function fitBlocks(doc, candidates, maxChars, { query = '', maxBlockChars = 2400 } = {}) {
  const chosen = []
  const seen = new Set()
  let used = 0
  let cut = false
  for (const block of candidates) {
    if (!block || seen.has(block.id)) continue
    seen.add(block.id)
    const overhead = renderBlocks(doc, [{ ...block, text: '' }]).length + 1
    const room = Math.min(maxBlockChars, maxChars - used - overhead)
    if (room < 40) { cut = true; continue }
    const terms = makeTermScores(query)
    const needle = [...terms.keys()].find(term => block.text.toLowerCase().includes(term)) ?? ''
    const text = bounded(block.text, room, needle)
    chosen.push({ ...block, text })
    used += renderBlocks(doc, [{ ...block, text }]).length + 1
    if (text !== block.text) cut = true
  }
  chosen.sort((a, b) => a.id - b.id)
  return { blocks: chosen, text: renderBlocks(doc, chosen), trimmed: cut }
}

/** Learning evidence never retrieves beyond anchor; the separate preview is judgment-only. */
export function buildLearningContext(doc, anchorId, options = {}, question = '') {
  const anchor = integer(anchorId, 0, 0, doc.blocks.length - 1)
  const configuredBudget = integer(options.learningContextChars, 24000, 4000, 120000)
  const budget = options.adaptiveReading === true ? Math.min(8000, configuredBudget) : configuredBudget
  const header = contextHeader(doc, anchor, options, anchor, budget)
  const beforeTitle = '\n\n# 已读内容（当前位置及之前；省略处可补读）\n'
  const aheadTitle = '\n\n# 后文预览（用户尚未读到，只用于判断；禁止泄露细节、定义或结论）\n'
  const room = Math.max(0, budget - header.length - beforeTitle.length - aheadTitle.length)
  const previewBudget = Math.min(integer(options.lookaheadChars, 6000, 0, 20000), Math.floor(room / 4))
  const ranked = rankedBlocks(doc, question, anchor, anchor).map(row => row.block)
  const recent = doc.blocks.slice(0, anchor).reverse()
  const before = fitBlocks(doc, [doc.blocks[anchor], ...ranked, ...recent], room - previewBudget, {
    query: question, maxBlockChars: Math.max(100, Math.min(8000, Math.floor((room - previewBudget) * 0.45))),
  })
  const aheadCandidates = doc.blocks.slice(anchor + 1)
  const ahead = fitBlocks(doc, aheadCandidates, previewBudget, { maxBlockChars: Math.max(100, previewBudget) })
  const text = header + beforeTitle + before.text + (ahead.blocks.length ? aheadTitle + ahead.text : '')
  return {
    text, anchor,
    trimmed: before.trimmed || before.blocks.length < anchor + 1 || ahead.trimmed || ahead.blocks.length < aheadCandidates.length || text.includes(OMITTED),
    aheadIds: ahead.blocks.map(block => block.id),
    aheadEnd: ahead.blocks.at(-1)?.id ?? anchor,
  }
}

/** Whole rendered context (labels and directory included) fits the configured budget. */
export function buildRereadContext(doc, anchorId, question, options = {}) {
  const anchor = integer(anchorId, 0, 0, doc.blocks.length - 1)
  const configuredBudget = integer(options.rereadContextChars, 48000, 8000, 160000)
  const budget = options.adaptiveReading === true ? Math.min(8000, configuredBudget) : configuredBudget
  const header = contextHeader(doc, anchor, options, Infinity, budget)
  const title = '\n\n# 正文依据（按位置排序；省略处可补读）\n'
  const room = Math.max(0, budget - header.length - title.length)
  const whole = renderBlocks(doc, doc.blocks)
  if (whole.length <= room) return { text: header + title + whole, anchor, full: true, trimmed: header.includes(OMITTED) }
  const ranked = rankedBlocks(doc, question, anchor).slice(0, 24).map(row => row.block)
  const candidates = [doc.blocks[anchor], ...ranked]
  for (const block of ranked) candidates.push(...neighborhood(doc, block.id, 1))
  candidates.push(...neighborhood(doc, anchor, 10).sort((a, b) => Math.abs(a.id - anchor) - Math.abs(b.id - anchor)))
  for (const item of doc.toc ?? []) candidates.push(findBlock(doc, item.blockId))
  const picked = fitBlocks(doc, candidates, room, { query: question, maxBlockChars: Math.max(100, Math.min(12000, Math.floor(room * 0.35))) })
  return { text: header + title + picked.text, anchor, full: false, trimmed: true }
}

/** Keep the selected passage's local window before spending budget on neighbors. */
export function buildTranslationContext(doc, blockId, selection, options = {}) {
  const block = findBlock(doc, blockId) ?? doc.blocks[0]
  const anchor = block.id
  const budget = integer(options.translationContextChars, 6000, 1000, 20000)
  const heading = nearestHeading(doc, anchor)
  const title = `选中内容所在段落（${bounded(blockRef(doc, block), 100)}）：\n`
  const selected = String(selection ?? '').trim()
  const anchorBudget = Math.min(Math.floor(budget * 0.7), budget - title.length)
  const local = bounded(block.text, anchorBudget, selected)
  let text = title + local
  if (heading && heading.id !== anchor) text += `\n所在小节：${bounded(heading.text, Math.min(160, budget - text.length - 10))}`
  const neighbors = []
  for (let distance = 1; distance <= 3; distance += 1) neighbors.push(doc.blocks[anchor - distance], doc.blocks[anchor + distance])
  const fitted = fitBlocks(doc, neighbors, Math.max(0, budget - text.length - 10), { maxBlockChars: Math.max(120, Math.floor(budget / 6)) })
  if (fitted.blocks.length) text += `\n附近上下文：\n${fitted.text}`
  return { text, block, selection: selected, heading: heading?.text ?? '', trimmed: local !== block.text || fitted.trimmed || text.includes(OMITTED) }
}

/** Pick the language instruction that best matches a free-form target setting. */
export function languageNameFor(code, fallback = '简体中文') {
  if (typeof code !== 'string' || code.trim() === '') return fallback
  return LANGUAGE_NAMES[code.trim()] ?? code.trim()
}

/** Keep newest complete user/assistant turns, including their local citation metadata. */
export function sanitizeHistory(history, maxChars = 12000) {
  if (!Array.isArray(history)) return ''
  const budget = integer(maxChars, 12000, 0, 12000)
  const turns = []
  let pending
  const format = entry => {
    const quote = typeof entry.quote === 'string' ? entry.quote : entry.quote?.text
    const page = entry.page ?? entry.quote?.page ?? entry.quote?.pdfPage
    const pdfPage = entry.pdfPage ?? entry.quote?.pdfPage ?? (typeof page === 'number' ? page : undefined)
    const blockId = entry.blockId ?? entry.quote?.blockId
    const crop = entry.crop ?? entry.quote?.crop
    let cropText = ''
    if (crop && typeof crop === 'object') {
      const { x, y, width, height } = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(crop[key])]))
      if ([x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && x < 1 && y < 1 && width > 0 && height > 0) {
        const normalized = { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) }
        cropText = JSON.stringify(Object.fromEntries(Object.entries(normalized).map(([key, value]) => [key, Number(value.toFixed(6))])))
      }
    }
    const label = typeof page === 'number' && Number.isFinite(page) && page >= 1
      ? `第 ${Math.floor(page)} 页` : typeof page === 'string' ? bounded(page, 100) : ''
    const metadata = [
      label ? `引用位置：${label}` : '',
      Number.isInteger(pdfPage) && pdfPage >= 1 ? `引用 PDF 页：pdfPage=${pdfPage}` : '',
      Number.isInteger(blockId) && blockId >= 0 ? `引用块：B${blockId}（blockId=${blockId}）` : '',
      cropText ? `引用框选（归一化坐标）：crop=${cropText}` : '',
      typeof quote === 'string' && quote.trim() ? `引用原文：${bounded(quote.trim(), 800)}` : '',
    ].filter(Boolean).join('\n')
    const role = entry.role === 'user' ? '用户' : '助手'
    return `${role}：${bounded(entry.content.trim(), Math.max(100, 3000 - metadata.length - role.length - 3))}${metadata ? `\n${metadata}` : ''}`
  }
  for (const entry of history) {
    if (!entry || typeof entry.content !== 'string' || !entry.content.trim()) continue
    if (entry.role === 'user') pending = entry
    else if (entry.role === 'assistant' && pending) {
      turns.push(`${format(pending)}\n\n${format(entry)}`)
      pending = undefined
    }
  }
  const selected = []
  let used = 0
  for (const turn of turns.slice(-5).reverse()) {
    const length = turn.length + (selected.length ? 2 : 0)
    if (used + length > budget) break
    selected.unshift(turn)
    used += length
  }
  return selected.join('\n\n')
}

export function buildAskPrompt({ doc, mode, anchorId, question, selection, history, options = {} }) {
  const learning = mode !== 'reread'
  const context = learning
    ? buildLearningContext(doc, anchorId, options, `${question}\n${selection ?? ''}`)
    : buildRereadContext(doc, anchorId, `${question}\n${selection ?? ''}`, options)
  const transcript = sanitizeHistory(history, options.historyContextChars)
  const quote = typeof selection === 'string' && selection.trim() !== ''
    ? `\n用户框选的原文：\n<<<\n${selection.trim()}\n>>>\n`
    : ''
  const modeSystem = learning
    ? `你是一位严谨、耐心的学习助教，当前处于【学习模式】。用户正在第一次读这份文档，读到 ${blockRef(doc, doc.blocks[context.anchor])}。

学习模式规则：
1. 只把“已读内容”（当前位置及之前）当作用户读过的材料，也允许使用通用常识。不要直接引用或泄露“后文预览”里的细节、定义和结论。
2. “后文预览”只用来判断：用户如果继续读下去，是否很快就会得到更系统的解释。如果确实如此，先在回答第一行输出标记：
   [[AHEAD:B123]]
   其中 B123 是后文开始详细解释的块编号。标记必须是回答的第一行。之后再用一句自然的话提醒用户“继续阅读到某页/某节会系统讲到”，不要展开后文的具体内容。
3. 如果后文没有更详细的解释，就完整回答当前问题，不要输出标记。
4. 如果已读内容不足以回答，明确说明“按目前读到的内容还无法确定”，并告诉用户需要继续读到哪一部分或补充什么背景。
5. 引用已读内容时，按下方“来源引用规则”标注依据。
6. 不要使用“后文预览”里的原话来回答问题。`
    : `你是一位善于建立知识联系的重读助教，当前处于【重读模式】。用户已经读过这份文档，正在重读或复习，当前位置是 ${blockRef(doc, doc.blocks[context.anchor])}。

重读模式规则：
1. 可以使用文档全文（包括当前位置之后的内容）来回答。
2. 尽可能把当前问题与文档其他部分联系起来：前后呼应、概念对照、例外条件、例子与总结之间的关系。
3. 如果文档不同位置存在互补或张力的说法，请指出，并解释它们如何共同构成完整图景。
4. 引用依据时，按下方“来源引用规则”标注位置。
5. 回答要具体、有结构，但不要为了联系而牵强附会；没有依据时直接说明。`
  const citationSystem = `${modeSystem}

来源引用规则：
- 对来自文档的关键结论、定义、公式解释或跨章节联系，在相关句末就近附上实际提供的准确位置，优先使用 [B12]；页面图片或只有页级依据时用 [第 3 页]，幻灯片用 [第 2 张]。一处结论有多个来源时分别标注。
- 只引用本次正文、页面图片或补读结果中实际可见的块号/页号；不要把阅读单元编号、图片附件序号或印刷页码猜成 PDF 物理页。Office 段落没有准确物理页映射时使用块引用。
- 清楚区分“原文明确指出”与“根据这些内容可以推断”；推断注明所依据的引用及必要假设。通用知识或无原文依据的解释应明确说明，不能伪装为文档结论。
- 引号中的文字必须是实际看到的原文，不得编造、改写后冒充逐字引文，或补全被截断/无法辨认的内容。目录、概览、历史回答和学习模式的后文预览不能充当正文证据；无法确定时说明限制。
- 引用用于定位来源，不代表结论已经过事实核验；不得宣称仅因附有引用就“已验证”。学习模式的范围和第一行 [[AHEAD:B123]] 规则优先，引用不能泄露后文。`

  const user = [
    `# 文档上下文`,
    context.text,
    '',
    quote,
    transcript === '' ? '' : `# 此前的对话\n${transcript}\n`,
    `# 用户的问题\n${String(question).trim()}`,
    '',
    '请用与用户提问相同的语言回答；用户未明确要求语言时默认用简体中文。使用 Markdown，先直接回答，再补充必要的解释。不要在回答中复述本提示。',
  ].join('\n')
  return {
    system: citationSystem,
    prompt: user,
    ahead: { anchor: context.anchor, ids: context.aheadIds ?? [], full: context.full ?? false },
    stats: {
      contextChars: context.text.length,
      trimmed: context.trimmed === true,
      full: context.full === true,
      historyChars: transcript.length,
      systemChars: citationSystem.length,
      promptChars: user.length,
    },
  }
}

export function buildTranslatePrompts({ doc, blockId, selection, targetLanguage, options }) {
  const context = buildTranslationContext(doc, blockId, selection, options)
  const target = languageNameFor(targetLanguage)
  const system = `你是一名专业的学术翻译，擅长结合上下文消除歧义。请把用户框选的内容翻译成${target}。

要求：
1. 利用给出的上下文判断词义、指代、术语和语气，但只翻译“选中内容”。
2. 保持原文的段落、列表、编号、公式、代码、专有名词和引用格式；术语前后一致。
3. 不要解释、不要总结、不要添加原文没有的内容，也不要输出“译文：”之类的标签。
4. 如果选中内容很短且脱离上下文无法确定含义，选择与上下文最一致的译法。`
  const prompt = [
    `# 文档`,
    `${doc.title}（${doc.kindLabel ?? doc.kind}）`,
    '',
    `# 上下文`,
    context.text,
    '',
    `# 选中内容（位于 ${blockRef(doc, context.block)}）`,
    '<<<',
    context.selection,
    '>>>',
    '',
    `请仅输出这段选中内容的${target}译文。`,
  ].join('\n')
  return {
    system,
    prompt,
    context,
    stats: {
      contextChars: context.text.length,
      trimmed: context.trimmed === true,
      selectionChars: context.selection.length,
      systemChars: system.length,
      promptChars: prompt.length,
    },
  }
}

/** Apply the learning-mode marker, accepting it only for a real look-ahead block. */
export function acceptAheadMarker(markerText, ahead) {
  const match = /^\s*\[\[AHEAD:B?(\d+)\]\]\s*$/i.exec(markerText.trim())
  if (match === null) return undefined
  const id = Number(match[1])
  if (!Number.isInteger(id)) return undefined
  if (ahead === undefined || ahead.full) return undefined
  if (!ahead.ids.includes(id)) return undefined
  return id
}
