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

function outlineText(doc, upToBlock = Number.POSITIVE_INFINITY) {
  const items = (doc.toc ?? []).filter(item => item.blockId <= upToBlock)
  if (items.length === 0) return '（无标题）'
  return items
    .map(item => `${'  '.repeat(Math.max(0, item.level - 1))}- ${item.title}（${pageLabelOf(doc, item.page)} · B${item.blockId}）`)
    .join('\n')
}

/**
 * Compact whole-book map: every chapter with its first few section titles.
 * Section names are real outline text, so this tells the model what each
 * chapter covers even when the page text layer cannot be extracted.
 */
export function bookMap(doc) {
  const lines = []
  let chapter = null
  let sections = 0
  for (const item of doc.toc ?? []) {
    if (lines.length >= 160) break
    if (item.level === 1) {
      chapter = item
      sections = 0
      lines.push(`- ${item.title}（${pageLabelOf(doc, item.page)}）`)
    } else if (item.level === 2 && chapter !== null && sections < 6) {
      sections += 1
      lines.push(`  - ${item.title}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : '（无目录）'
}

function renderBlocks(doc, blocks, options = {}) {
  const lines = []
  let page = -1
  for (const block of blocks) {
    if (page !== block.page) {
      page = block.page
      lines.push(`\n--- ${pageLabelOf(doc, page)} ---`)
    }
    const prefix = `[B${block.id}]`
    if (block.type === 'heading') lines.push(`${prefix} ## ${block.text}`)
    else if (block.type === 'list-item') lines.push(`${prefix} - ${block.text}`)
    else if (block.type === 'table') lines.push(`${prefix} [表格]\n${block.text}`)
    else if (block.type === 'note') lines.push(`${prefix} [演讲者备注] ${block.text}`)
    else if (block.type === 'code') lines.push(`${prefix} [代码]\n${block.text}`)
    else lines.push(`${prefix} ${block.text}`)
  }
  return lines.join('\n')
}

function makeTermScores(query) {
  const scores = new Map()
  for (const match of query.toLowerCase().matchAll(LATIN_RE)) {
    const term = match[0]
    if (term.length < 2 || STOP_WORDS.has(term)) continue
    scores.set(term, 1)
  }
  for (const match of query.matchAll(CJK_RUN_RE)) {
    const run = match[0]
    if (run.length === 1) {
      scores.set(run, Math.max(scores.get(run) ?? 0, 0.5))
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2)
      scores.set(bigram, Math.max(scores.get(bigram) ?? 0, 1.5))
    }
  }
  return scores
}

function retrieve(doc, query, limit, anchorId) {
  const terms = makeTermScores(query)
  if (terms.size === 0) return []
  const scored = []
  const headingIds = new Set((doc.toc ?? []).map(item => item.blockId))
  for (const block of doc.blocks) {
    const haystack = block.text.toLowerCase()
    let score = 0
    for (const [term, weight] of terms) {
      if (haystack.includes(term)) score += weight
    }
    if (score <= 0) continue
    if (block.type === 'heading') score += 2.5
    if (headingIds.has(block.id)) score += 1
    const distance = Math.abs(block.id - anchorId)
    score += Math.max(0, 3 - distance / 80)
    scored.push({ block, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(entry => entry.block)
}

function neighborhood(doc, anchorId, radius) {
  const start = clamp(anchorId - radius, 0, doc.blocks.length - 1)
  const end = clamp(anchorId + radius, 0, doc.blocks.length - 1)
  return doc.blocks.slice(start, end + 1)
}

/**
 * Learning-mode context: everything before the anchor (bounded), the exact
 * anchor, and a limited look-ahead clearly marked as not-yet-read.
 */
export function buildLearningContext(doc, anchorId, options) {
  const anchor = clamp(Number(anchorId) || 0, 0, doc.blocks.length - 1)
  const beforeBudget = clamp(Number(options.learningContextChars) || 24_000, 4_000, 120_000)
  const aheadBudget = clamp(Number(options.lookaheadChars) || 6_000, 800, 20_000)
  const before = doc.blocks.slice(0, anchor + 1)
  const beforeChars = before.reduce((total, block) => total + block.text.length, 0)
  let beforeBlocks = before
  let trimmed = false
  if (beforeChars > beforeBudget) {
    trimmed = true
    let used = 0
    let start = before.length - 1
    for (let index = before.length - 1; index >= 0; index -= 1) {
      const length = before[index].text.length
      if (used + length > beforeBudget) break
      used += length
      start = index
    }
    beforeBlocks = before.slice(start)
  }

  let aheadChars = 0
  const ahead = []
  let aheadEnd = anchor
  for (let index = anchor + 1; index < doc.blocks.length; index += 1) {
    const block = doc.blocks[index]
    if (aheadChars + block.text.length > aheadBudget) break
    aheadChars += block.text.length
    aheadEnd = index
    ahead.push(block)
  }

  const current = doc.blocks[anchor]
  const heading = nearestHeading(doc, anchor)
  const header = [
    `# 文档`,
    `标题：${doc.title}`,
    `类型：${doc.kindLabel ?? doc.kind}　总${doc.pages.length}个阅读单元　共${doc.stats.chars}字`,
    '',
    `# 全书章节概览（每章包含的小节）`,
    bookMap(doc),
    '',
    `# 目录（用于定位已读内容）`,
    outlineText(doc, anchor),
    '',
    `# 用户当前位置`,
    `位置：${blockRef(doc, current)}${heading !== undefined && heading.id !== anchor ? `，所在小节「${heading.text}」` : ''}`,
    `当前段落：${current.text}`,
    '',
    `# 已读内容（当前位置及之前）${trimmed ? '（前文较长，仅保留最近部分）' : ''}`,
    trimmed ? '（更早的正文已省略；目录仍保留完整结构。）' : '',
    renderBlocks(doc, beforeBlocks),
  ].join('\n')

  const aheadSection = ahead.length === 0
    ? ''
    : [
      '',
      '# 后文预览（用户尚未读到，只用于判断）',
      `以下内容紧接当前位置之后，范围 B${anchor + 1}–B${aheadEnd}。它只用于判断“用户继续读下去是否会得到更详细的解释”。禁止把这里的细节、术语定义或结论直接泄露到回答中。`,
      renderBlocks(doc, ahead),
    ].join('\n')

  return {
    text: header + aheadSection,
    anchor,
    aheadIds: ahead.map(block => block.id),
    aheadEnd,
  }
}

/** Rereading-mode context: the whole document when it fits, otherwise an outline plus retrieved evidence. */
export function buildRereadContext(doc, anchorId, question, options) {
  const anchor = clamp(Number(anchorId) || 0, 0, doc.blocks.length - 1)
  const budget = clamp(Number(options.rereadContextChars) || 48_000, 8_000, 160_000)
  const totalChars = doc.stats.chars
  const header = [
    `# 文档`,
    `标题：${doc.title}`,
    `类型：${doc.kindLabel ?? doc.kind}　总${doc.pages.length}个阅读单元　共${totalChars}字`,
    '',
    `# 全书章节概览（每章包含的小节）`,
    bookMap(doc),
    '',
    `# 用户当前位置`,
    `位置：${blockRef(doc, doc.blocks[anchor])}`,
    '',
    `# 目录`,
    outlineText(doc),
  ].join('\n')

  if (totalChars <= budget) {
    return {
      text: `${header}\n\n# 全文（带位置标记）\n${renderBlocks(doc, doc.blocks)}`,
      anchor,
      full: true,
    }
  }

  const picked = new Map()
  for (const block of neighborhood(doc, anchor, 10)) picked.set(block.id, block)
  for (const block of retrieve(doc, question, 18, anchor)) {
    picked.set(block.id, block)
    for (const neighbor of neighborhood(doc, block.id, 1)) picked.set(neighbor.id, neighbor)
  }
  // Include distinct section openings so the model can connect the answer to
  // the document's overall argument.
  for (const item of (doc.toc ?? []).slice(0, 24)) {
    const block = findBlock(doc, item.blockId)
    if (block !== undefined) picked.set(block.id, block)
  }
  const ordered = [...picked.values()].sort((a, b) => a.id - b.id)
  let used = 0
  const selected = []
  for (const block of ordered) {
    if (used + block.text.length > budget) continue
    used += block.text.length
    selected.push(block)
  }
  return {
    text: `${header}\n\n# 与问题最相关的全文片段（已按位置排序；未展示的段落可通过目录定位）\n${renderBlocks(doc, selected)}`,
    anchor,
    full: false,
  }
}

/** Context window around a selected passage for translation. */
export function buildTranslationContext(doc, blockId, selection, options) {
  const block = findBlock(doc, blockId) ?? doc.blocks[0]
  const anchor = block.id
  const before = doc.blocks.slice(Math.max(0, anchor - 3), anchor)
  const after = doc.blocks.slice(anchor + 1, Math.min(doc.blocks.length, anchor + 4))
  const budget = clamp(Number(options.translationContextChars) || 6_000, 1_000, 20_000)
  const heading = nearestHeading(doc, anchor)
  const pieces = []
  if (heading !== undefined && heading.id !== anchor) pieces.push(`所在小节：${heading.text}`)
  if (before.length > 0) pieces.push(`上文：\n${renderBlocks(doc, before)}`)
  pieces.push(`选中内容所在段落（${blockRef(doc, block)}）：\n${block.text}`)
  if (after.length > 0) pieces.push(`下文：\n${renderBlocks(doc, after)}`)
  let text = pieces.join('\n\n')
  if (text.length > budget) text = `${text.slice(0, budget)}\n…（上下文已截断）`
  return {
    text,
    block,
    selection: String(selection).trim(),
    heading: heading?.text ?? '',
  }
}

/** Pick the language instruction that best matches a free-form target setting. */
export function languageNameFor(code, fallback = '简体中文') {
  if (typeof code !== 'string' || code.trim() === '') return fallback
  return LANGUAGE_NAMES[code.trim()] ?? code.trim()
}

/** Keep a client-supplied transcript small and well-shaped. */
export function sanitizeHistory(history) {
  if (!Array.isArray(history)) return ''
  const rows = []
  let used = 0
  for (const entry of history.slice(-10)) {
    if (entry === null || typeof entry !== 'object') continue
    const role = entry.role === 'assistant' ? '助手' : entry.role === 'user' ? '用户' : null
    if (role === null) continue
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (content === '') continue
    const capped = content.length > 3_000 ? `${content.slice(0, 3_000)}…` : content
    if (used + capped.length > 12_000) break
    used += capped.length
    rows.push(`${role}：${capped}`)
  }
  return rows.join('\n\n')
}

export function buildAskPrompt({ doc, mode, anchorId, question, selection, history, options }) {
  const learning = mode !== 'reread'
  const context = learning
    ? buildLearningContext(doc, anchorId, options)
    : buildRereadContext(doc, anchorId, `${question}\n${selection ?? ''}`, options)
  const transcript = sanitizeHistory(history)
  const quote = typeof selection === 'string' && selection.trim() !== ''
    ? `\n用户框选的原文：\n<<<\n${selection.trim()}\n>>>\n`
    : ''
  const modeSystem = learning
    ? `你是一位严谨、耐心的学习助教，当前处于【学习模式】。用户正在第一次读这份文档，读到 ${blockRef(doc, doc.blocks[context.anchor])}。

学习模式规则：
1. 只把“已读内容”（当前位置及之前）当作用户读过的材料，也允许使用通用常识。不要直接引用或泄露“后文预览”里的细节、定义和结论。
2. “后文预览”只用来判断：用户如果继续读下去，是否很快就会得到更系统的解释。如果确实如此，先用已读内容给出一个足够理解当前问题的简短回答，然后单独输出一行标记：
   [[AHEAD:B123]]
   其中 B123 是后文开始详细解释的块编号。标记必须是回答的第一行。之后再用一句自然的话提醒用户“继续阅读到某页/某节会系统讲到”，不要展开后文的具体内容。
3. 如果后文没有更详细的解释，就完整回答当前问题，不要输出标记。
4. 如果已读内容不足以回答，明确说明“按目前读到的内容还无法确定”，并告诉用户需要继续读到哪一部分或补充什么背景。
5. 引用已读内容时尽量标注位置，如 [第 3 页] 或 [B12]。
6. 不要使用“后文预览”里的原话来回答问题。`
    : `你是一位善于建立知识联系的重读助教，当前处于【重读模式】。用户已经读过这份文档，正在重读或复习，当前位置是 ${blockRef(doc, doc.blocks[context.anchor])}。

重读模式规则：
1. 可以使用文档全文（包括当前位置之后的内容）来回答。
2. 尽可能把当前问题与文档其他部分联系起来：前后呼应、概念对照、例外条件、例子与总结之间的关系。
3. 如果文档不同位置存在互补或张力的说法，请指出，并解释它们如何共同构成完整图景。
4. 引用依据时标注位置，如 [第 3 页]、[第 2 张] 或 [B12]。
5. 回答要具体、有结构，但不要为了联系而牵强附会；没有依据时直接说明。`

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
    system: modeSystem,
    prompt: user,
    ahead: { anchor: context.anchor, ids: context.aheadIds ?? [], full: context.full ?? false },
    stats: {
      contextChars: context.text.length,
      trimmed: context.trimmed === true,
      full: context.full === true,
      historyChars: transcript.length,
      systemChars: modeSystem.length,
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
