/**
 * Document extraction for the Study Reader.
 *
 * The reader is text-first on purpose: every visible character is real DOM
 * text, so native selection, the translation popover, and precise Q&A
 * anchoring work for all supported formats. PDFs additionally get an
 * "original" tab that renders the real file through the browser.
 *
 * - PDF: pdfjs-dist text geometry, grouped into lines/paragraphs.
 * - DOCX: OOXML paragraphs, headings, lists and tables.
 * - PPTX: one section per slide, including speaker notes.
 * - Markdown / text: headings and paragraphs.
 */
import { Buffer } from 'node:buffer'
import { extname } from 'node:path'
import { openZip, decodeXmlEntities, xmlAttr } from './zip.js'

const UTF8 = new TextDecoder('utf-8', { fatal: false })
const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/
const BULLET_RE = /^\s*(?:[•·▪◦‣*+\-–—]|\d{1,2}[.)、]|[（(]\d{1,2}[)）])\s+/

export const SUPPORTED_EXTENSIONS = Object.freeze(['pdf', 'docx', 'pptx', 'doc', 'ppt', 'md', 'markdown', 'txt'])

export class ExtractError extends Error {
  constructor(message, code = 'extract-failed') {
    super(message)
    this.name = 'ExtractError'
    this.code = code
  }
}

function cleanText(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanInline(value) {
  return String(value).replace(/\s+/g, ' ').replace(/\u0000/g, '').trim()
}

function isCjk(char) {
  return typeof char === 'string' && CJK_RE.test(char)
}

function joinWrapped(a, b) {
  if (a === '') return b
  if (b === '') return a
  if (a.endsWith('-') && /^[a-z]/.test(b)) return `${a.slice(0, -1)}${b}`
  if (isCjk(a[a.length - 1]) || isCjk(b[0])) return `${a}${b}`
  return `${a} ${b}`
}

function median(values) {
  return quantile(values, 0.5)
}

function quantile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))
  return sorted[at]
}

function extensionOf(path) {
  return extname(path).slice(1).toLowerCase()
}

function headingLevelFor(style, outline) {
  if (Number.isInteger(outline) && outline >= 0 && outline <= 8) return Math.min(3, outline + 1)
  if (typeof style !== 'string' || style === '') return 0
  const compact = style.replace(/[\s_-]/g, '').toLowerCase()
  if (compact === 'title' || compact === '标题') return 1
  const match = /(?:heading|标题|h)([1-6])$/.exec(compact)
  if (match !== null) return Math.min(3, Math.max(1, Number(match[1])))
  return 0
}

function isListParagraph(style, text) {
  if (BULLET_RE.test(text)) return true
  if (typeof style !== 'string') return false
  return /list|列表/i.test(style)
}

function makeBlock(page, type, text, extra = {}) {
  const value = type === 'code' ? String(text).trim() : cleanText(text)
  if (value === '') return null
  return { page, type, text: value, ...extra }
}

/** Build page descriptors, TOC and stats for an extracted block list. */
function finalizeDocument({ blocks, pages, meta, warnings }) {
  const normalized = blocks.filter(block => block !== null)
  if (normalized.length === 0) {
    throw new ExtractError('文档中没有可提取的正文文本。若这是扫描版 PDF，可切换到“原貌”查看。', 'no-text')
  }
  normalized.forEach((block, index) => {
    block.id = index
    if (!Number.isInteger(block.page) || block.page < 0) block.page = 0
  })

  const pageCount = pages.length > 0 ? pages.length : 1
  const pageList = []
  const sourceToPage = new Map()
  for (let index = 0; index < pageCount; index += 1) {
    const source = pages[index] ?? {}
    const memberIds = normalized.filter(block => block.page === index).map(block => block.id)
    if (memberIds.length === 0 && pages.length > 0) continue
    sourceToPage.set(index, pageList.length)
    const page = {
      index: pageList.length,
      label: source.label ?? `第 ${index + 1} 页`,
      title: source.title ?? '',
      blockIds: memberIds,
    }
    // PDF pages remember their 1-based source page so the embedded outline can
    // be mapped back even after empty pages are dropped here.
    if (Number.isInteger(source.pdfPage) && source.pdfPage > 0) page.pdfPage = source.pdfPage
    pageList.push(page)
  }
  if (pageList.length === 0) {
    pageList.push({ index: 0, label: '正文', title: '', blockIds: normalized.map(block => block.id) })
    normalized.forEach(block => { block.page = 0 })
  } else {
    // Re-map page indices after empty pages were dropped. The old index is a
    // source index, not a pageList index, so it cannot be used as-is.
    for (const block of normalized) {
      const mapped = sourceToPage.get(block.page)
      block.page = mapped === undefined ? 0 : mapped
    }
    pageList.forEach((page, index) => {
      page.blockIds = normalized.filter(block => block.page === index).map(block => block.id)
    })
  }

  const toc = normalized
    .filter(block => block.type === 'heading' && Number(block.level ?? 1) <= 3)
    .slice(0, 160)
    .map(block => ({
      blockId: block.id,
      page: block.page,
      level: Math.min(3, Math.max(1, Number(block.level ?? 1))),
      title: block.text.length > 120 ? `${block.text.slice(0, 117)}…` : block.text,
    }))

  const chars = normalized.reduce((total, block) => total + block.text.length, 0)
  const title = meta.title?.trim() || toc[0]?.title || meta.name.replace(/\.[^.]+$/, '') || '未命名文档'
  return {
    ...meta,
    title,
    blocks: normalized,
    pages: pageList,
    toc,
    warnings: warnings ?? [],
    stats: {
      blocks: normalized.length,
      pages: pageList.length,
      chars,
      words: countWords(normalized.map(block => block.text).join(' ')),
    },
  }
}

// ── PDF outline ──────────────────────────────────────────────────────────────

const OUTLINE_MAX_ENTRIES = 300
const OUTLINE_MAX_LEVEL = 3

/**
 * Read the PDF's embedded bookmarks. When a file ships its own outline it is
 * the authoritative chapter structure: titles, nesting and destination pages
 * all come from the document instead of font-size guessing.
 */
async function pdfOutlineEntries(document) {
  let outline
  try {
    outline = await document.getOutline()
  } catch {
    return []
  }
  if (!Array.isArray(outline) || outline.length === 0) return []
  const entries = []
  const pageOf = async dest => {
    try {
      let target = dest
      if (typeof target === 'string') target = await document.getDestination(target)
      if (!Array.isArray(target) || target.length === 0) return 0
      const index = await document.getPageIndex(target[0])
      return Number.isInteger(index) && index >= 0 ? index + 1 : 0
    } catch {
      return 0
    }
  }
  const walk = async (items, level) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (entries.length >= OUTLINE_MAX_ENTRIES) return
      if (item === null || typeof item !== 'object') continue
      const title = cleanInline(String(item.title ?? ''))
      if (title !== '') {
        const page = await pageOf(item.dest)
        if (page > 0) {
          entries.push({
            title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
            page,
            level: Math.min(OUTLINE_MAX_LEVEL, level),
          })
        }
      }
      if (level < OUTLINE_MAX_LEVEL) await walk(item.items, level + 1)
    }
  }
  await walk(outline, 1)
  return entries
}

/**
 * Map outline destinations (1-based PDF pages) onto the finalized page list,
 * which dropped pages without extractable text. A destination that lands on
 * such a page jumps to the next page that does have text.
 */
function tocFromOutline(entries, doc) {
  const bySourcePage = new Map()
  for (const [index, page] of doc.pages.entries()) {
    if (Number.isInteger(page.pdfPage) && page.pdfPage > 0) bySourcePage.set(page.pdfPage, index)
  }
  if (bySourcePage.size === 0) return []
  const ordered = [...bySourcePage.keys()].sort((a, b) => a - b)
  const lastSourcePage = ordered[ordered.length - 1]
  const indexFor = sourcePage => {
    const exact = bySourcePage.get(sourcePage)
    if (exact !== undefined) return exact
    if (sourcePage > lastSourcePage) return undefined
    for (const candidate of ordered) {
      if (candidate > sourcePage) return bySourcePage.get(candidate)
    }
    return undefined
  }
  const toc = []
  const seen = new Set()
  for (const entry of entries) {
    const pageIndex = indexFor(entry.page)
    if (pageIndex === undefined) continue
    const blockId = doc.pages[pageIndex]?.blockIds?.[0]
    if (!Number.isInteger(blockId)) continue
    const key = `${pageIndex}\u0000${entry.level}\u0000${entry.title}`
    if (seen.has(key)) continue
    seen.add(key)
    toc.push({ blockId, page: pageIndex, level: entry.level, title: entry.title })
  }
  return toc
}

function countWords(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  return cjk + latin
}

/** Split un-paginated documents into readable, citable sections. */
function assignSections(blocks, preferredLevel = 1, budget = 2400) {
  const hasChosenHeading = blocks.some(block => block.type === 'heading' && Number(block.level ?? 9) <= preferredLevel)
  const splitLevel = hasChosenHeading ? preferredLevel : 2
  const pages = []
  let current = null
  let currentChars = 0
  const startPage = title => {
    current = { label: `第 ${pages.length + 1} 节`, title: title ?? '', blocks: [] }
    pages.push(current)
    currentChars = 0
  }
  for (const block of blocks) {
    const heading = block.type === 'heading' ? Number(block.level ?? 9) : 9
    const newSection = current === null
      || (heading <= splitLevel && current.blocks.length > 0)
      || (currentChars >= budget && heading <= splitLevel + 1 && current.blocks.length > 0)
    if (newSection) {
      startPage(heading <= splitLevel ? block.text : '')
    }
    block.page = pages.length - 1
    current.blocks.push(block)
    currentChars += block.text.length
  }
  if (pages.length === 0) pages.push({ label: '正文', title: '', blocks: [] })
  return pages.map((page, index) => ({
    index,
    label: pages.length > 1 ? page.label : '正文',
    title: page.title,
  }))
}

function inferTitleFromBlocks(zip, blocks, fallback, corePath = 'docProps/core.xml') {
  const core = zip.text(corePath)
  if (core !== undefined) {
    const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(core)
    if (title !== null) {
      const decoded = decodeXmlEntities(title[1]).trim()
      if (decoded !== '') return decoded
    }
  }
  const heading = blocks.find(block => block.type === 'heading')
  return heading?.text || fallback
}

// ── PDF ────────────────────────────────────────────────────────────────────

async function extractPdf(bytes, options) {
  let pdfjs
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch (error) {
    throw new ExtractError(`PDF 解析组件未安装：${error instanceof Error ? error.message : String(error)}`, 'pdfjs-missing')
  }
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  })
  let document
  try {
    document = await loading.promise
  } catch (error) {
    try { await loading.destroy() } catch { /* already settled */ }
    if (error?.name === 'PasswordException') {
      throw new ExtractError('这个 PDF 有密码保护，暂时无法提取文字。可以用系统 PDF 阅读器打开。', 'password-protected')
    }
    throw new ExtractError(`无法打开 PDF：${error instanceof Error ? error.message : String(error)}`, 'pdf-invalid')
  }

  let pdfTitle = ''
  try {
    const metadata = await document.getMetadata()
    const candidate = metadata?.info?.Title
    if (typeof candidate === 'string' && candidate.trim() !== '') pdfTitle = candidate.trim()
  } catch { /* metadata is optional */ }
  // The embedded outline must be read while the document is alive; resolving
  // its named destinations needs the same page tree the text loop uses.
  const outlineEntries = await pdfOutlineEntries(document)
  const allBlocks = []
  const pages = []
  const warnings = []
  const maxPages = Math.min(Number(options.maxPdfPages ?? 500), 2000)
  const pageCount = Math.min(document.numPages, maxPages)
  if (document.numPages > maxPages) warnings.push(`文档共 ${document.numPages} 页，仅提取前 ${maxPages} 页。`)
  let totalChars = 0
  const maxChars = Number(options.maxPdfChars ?? 2_000_000)

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent({ includeMarkedContent: false })
      const pageIndex = pageNumber - 1
      const pageBlocks = pdfPageBlocks(content.items, pageIndex)
      for (const block of pageBlocks) {
        if (totalChars + block.text.length > maxChars) break
        totalChars += block.text.length
        allBlocks.push(block)
      }
      pages.push({
        index: pageIndex,
        label: `第 ${pageNumber} 页`,
        title: pageBlocks.find(block => block.type === 'heading')?.text ?? '',
        pdfPage: pageNumber,
      })
      try { page.cleanup() } catch { /* page was already released */ }
      if (totalChars >= maxChars) {
        warnings.push('文档正文过长，阅读器仅保留了前面的部分内容。')
        break
      }
    }
  } finally {
    try { await loading.destroy() } catch { /* ignore teardown races */ }
  }

  if (allBlocks.length === 0) {
    warnings.push('没有提取到可选中的正文，可能是扫描版 PDF。请切换到“原貌”查看。')
    allBlocks.push(makeBlock(0, 'paragraph', '（此 PDF 没有可提取的文本层，可能是扫描件。请切换到“原貌”查看原文件。）'))
    if (pages.length === 0) pages.push({ index: 0, label: '第 1 页', title: '' })
  }

  const doc = finalizeDocument({
    blocks: allBlocks,
    pages,
    meta: {
      kind: 'pdf',
      extension: 'pdf',
      title: pdfTitle || options.name.replace(/\.[^.]+$/, ''),
      name: options.name,
      canPreview: true,
    },
    warnings,
  })
  const outlineToc = tocFromOutline(outlineEntries, doc)
  if (outlineToc.length > 0) {
    doc.toc = outlineToc
    doc.tocSource = 'outline'
  }
  return doc
}

function pdfPageBlocks(items, pageIndex) {
  const entries = []
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || item.str === '') continue
    const transform = Array.isArray(item.transform) ? item.transform : null
    if (transform === null) continue
    const height = Math.abs(Number(item.height) || Math.abs(transform[3]) || 10)
    entries.push({
      str: item.str,
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Math.abs(Number(item.width) || 0),
      height,
      fontSize: Math.abs(Number(transform[3]) || Math.abs(transform[0]) || height) || 10,
    })
  }
  if (entries.length === 0) return []

  // Group text runs into visual lines. Most PDF producers use one baseline
  // exactly, while a minority jitter by fractions of a point.
  entries.sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const lines = []
  for (const entry of entries) {
    const tolerance = Math.max(1.6, entry.height * 0.32)
    const line = lines.find(candidate => Math.abs(candidate.y - entry.y) <= tolerance)
    if (line === undefined) {
      lines.push({ y: entry.y, items: [entry] })
    } else {
      line.items.push(entry)
      if (entry.height > line.height) line.height = entry.height
    }
  }
  lines.sort((a, b) => b.y - a.y)

  const visualLines = []
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    let text = ''
    let previousEnd = null
    let x = Infinity
    let fontSize = 0
    for (const item of line.items) {
      if (text !== '') {
        const previous = text[text.length - 1]
        const first = item.str[0] ?? ''
        const gap = previousEnd === null ? 0 : item.x - previousEnd
        const spacer = gap > Math.max(0.7, item.height * 0.12)
          && !isCjk(previous) && !isCjk(first)
          && !/\s$/.test(text) && !/^[,.;:!?%)\]}]/.test(item.str)
          ? ' '
          : ''
        text += spacer
      }
      text += item.str
      x = Math.min(x, item.x)
      previousEnd = item.x + item.width
      fontSize = Math.max(fontSize, item.fontSize)
    }
    text = cleanInline(text)
    if (text === '') continue
    // Drop bare page numbers and common running footers.
    if (/^(?:page\s*)?\d{1,4}(?:\s*\/\s*\d{1,4})?$/i.test(text) && text.length <= 12) continue
    visualLines.push({ text, x: Number.isFinite(x) ? x : 0, y: line.y, height: line.height, fontSize })
  }
  if (visualLines.length === 0) return []

  const bodySize = median(visualLines.map(line => line.fontSize)) || 10
  const gaps = []
  for (let index = 1; index < visualLines.length; index += 1) {
    const gap = visualLines[index - 1].y - visualLines[index].y
    if (gap > 0.5 && gap < bodySize * 4) gaps.push(gap)
  }
  // The 25th percentile, not the median: paragraph gaps inflate the median on
  // sparse pages and would merge every paragraph into one block.
  const normalGap = quantile(gaps, 0.25) || bodySize * 1.4
  const blocks = []
  let current = null
  for (const line of visualLines) {
    const bullet = BULLET_RE.test(line.text)
    const big = line.fontSize >= bodySize * 1.24 && line.text.length <= 160
    const gap = current === null ? 0 : current.lastY - line.y
    const indentJump = current !== null && Math.abs(line.x - current.x) > bodySize * 1.2
    const sizeJump = current !== null && Math.abs(line.fontSize - current.lastSize) > bodySize * 0.22
    const startsNew = current === null
      || gap > normalGap * 1.45
      || indentJump
      || sizeJump
      || bullet
      || (current.endsSentence && gap > normalGap * 1.15)
      || (big && current.text.length > 0)
    if (startsNew) {
      if (current !== null) blocks.push(finishPdfBlock(current, pageIndex, bodySize))
      current = {
        text: line.text,
        x: line.x,
        lastY: line.y,
        lastSize: line.fontSize,
        fontSize: line.fontSize,
        endsSentence: /[。！？.!?][”’"')）\]]?$/.test(line.text),
        bullet,
      }
    } else {
      current.text = joinWrapped(current.text, line.text)
      current.fontSize = Math.max(current.fontSize, line.fontSize)
      current.lastY = line.y
      current.lastSize = line.fontSize
      current.endsSentence = /[。！？.!?][”’"')）\]]?$/.test(line.text)
    }
  }
  if (current !== null) blocks.push(finishPdfBlock(current, pageIndex, bodySize))
  return blocks.filter(Boolean)
}

function looksLikePdfHeading(text) {
  if (text.length === 0 || text.length > 80) return false
  // Display math is often the largest type on a page, so require actual words:
  // "A", "6 Q" and "7.9" are formulas or symbols, not headings.
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (letters < 2) return false
  if (/^(?:page\s*)?\d+(?:[\s./:-]+\d+)*$/i.test(text)) return false
  return true
}

function finishPdfBlock(current, pageIndex, bodySize) {
  const text = cleanInline(current.text)
  if (text === '') return null
  const heading = current.fontSize >= bodySize * 1.24 && looksLikePdfHeading(text)
  const list = current.bullet || BULLET_RE.test(text)
  const type = heading ? 'heading' : list ? 'list-item' : 'paragraph'
  const level = heading ? (current.fontSize >= bodySize * 1.6 ? 1 : 2) : undefined
  // Symbol bullets are drawn by the reader; keep ordered-list numbers in text.
  const body = list ? text.replace(/^[•·▪◦‣*+\-–—]\s+/, '') : text
  return makeBlock(pageIndex, type, body, level === undefined ? {} : { level })
}

// ── DOCX ───────────────────────────────────────────────────────────────────

function extractDocx(bytes, options) {
  const zip = openZip(bytes)
  const xml = zip.text('word/document.xml')
  if (xml === undefined) throw new ExtractError('Word 文档缺少 word/document.xml，可能不是有效的 .docx 文件。', 'docx-invalid')
  const blocks = []
  let paragraph = null
  let inText = false
  let table = null
  let row = null
  let cell = null
  let textBoxDepth = 0
  const tagPattern = /<([^>]+)>|([^<]+)/g

  const finishParagraph = () => {
    if (paragraph === null) return
    const text = paragraph.text.replace(/[ \t]+\n/g, '\n').trim()
    if (text !== '' && textBoxDepth === 0) {
      if (cell !== null) {
        cell.paragraphs.push(text)
      } else {
        const level = headingLevelFor(paragraph.style, paragraph.outline)
        if (level > 0) {
          blocks.push(makeBlock(0, 'heading', text, { level }))
        } else if (paragraph.list === true || isListParagraph(paragraph.style, text)) {
          blocks.push(makeBlock(0, 'list-item', text))
        } else {
          blocks.push(makeBlock(0, 'paragraph', text))
        }
      }
    }
    paragraph = null
  }

  for (const match of xml.matchAll(tagPattern)) {
    const rawTag = match[1]
    const rawText = match[2]
    if (rawText !== undefined) {
      if (inText && paragraph !== null) paragraph.text += decodeXmlEntities(rawText)
      continue
    }
    if (rawTag === undefined) continue
    const closing = rawTag.trimStart().startsWith('/')
    const selfClosing = rawTag.trimEnd().endsWith('/')
    const body = rawTag.trim().replace(/^\/+/, '').replace(/\/$/, '')
    const spaceAt = body.search(/\s/)
    const tagName = (spaceAt === -1 ? body : body.slice(0, spaceAt)).split(':').pop().toLowerCase()
    const attrs = spaceAt === -1 ? '' : body.slice(spaceAt)
    if (tagName === 't') {
      inText = !closing && !selfClosing
      continue
    }
    if (tagName === 'txbxcontent' && !selfClosing) {
      textBoxDepth = closing ? Math.max(0, textBoxDepth - 1) : textBoxDepth + 1
      continue
    }
    if (table === null) {
      if (tagName === 'p' && !closing) {
        paragraph = { text: '', style: '', outline: undefined }
        inText = false
        continue
      }
      if (tagName === 'tbl' && !closing) {
        finishParagraph()
        table = { rows: [] }
        continue
      }
    } else {
      if (tagName === 'tbl' && closing) {
        finishParagraph()
        const rows = table.rows.filter(entry => entry.length > 0)
        if (rows.length > 0) blocks.push(makeBlock(0, 'table', rows.map(entry => entry.join(' | ')).join('\n'), { table: rows }))
        table = null
        row = null
        cell = null
        continue
      }
      if (tagName === 'tr') {
        if (closing) {
          if (row !== null) table.rows.push(row.cells)
          row = null
        } else {
          row = { cells: [] }
        }
        continue
      }
      if (tagName === 'tc') {
        if (closing) {
          if (row !== null) row.cells.push(cell === null ? '' : cell.paragraphs.join('\n').trim())
          cell = null
        } else {
          cell = { paragraphs: [] }
        }
        continue
      }
      if (tagName === 'p' && !closing) {
        paragraph = { text: '', style: '', outline: undefined }
        inText = false
        continue
      }
    }
    if (paragraph === null) continue
    if (tagName === 'pstyle' && !closing) {
      paragraph.style = xmlAttr(attrs, 'val') ?? ''
      continue
    }
    if (tagName === 'numpr' && !closing) {
      paragraph.list = true
      continue
    }
    if (tagName === 'outlinelvl' && !closing) {
      const value = Number(xmlAttr(attrs, 'val'))
      if (Number.isInteger(value)) paragraph.outline = value
      continue
    }
    if (tagName === 'tab' && !closing) {
      paragraph.text += '\t'
      continue
    }
    if ((tagName === 'br' || tagName === 'cr') && !closing) {
      paragraph.text += '\n'
      continue
    }
    if (tagName === 'nobreakhyphen' && !closing) {
      paragraph.text += '-'
      continue
    }
    if (tagName === 'p' && closing) finishParagraph()
  }
  finishParagraph()

  if (blocks.length === 0) {
    throw new ExtractError('Word 文档中没有可提取的段落文本。', 'docx-empty')
  }
  const name = options.name
  const title = inferTitleFromBlocks(zip, blocks, name.replace(/\.[^.]+$/, ''))
  const pages = assignSections(blocks, 2)
  return finalizeDocument({
    blocks,
    pages,
    meta: { kind: 'docx', extension: 'docx', title, name, canPreview: Boolean(options.officeAvailable) },
    warnings: options.officeAvailable ? [] : ['未检测到 Office 转 PDF 服务，“原貌”视图不可用；研读视图不受影响。'],
  })
}

// ── PPTX ───────────────────────────────────────────────────────────────────

function extractPptx(bytes, options) {
  const zip = openZip(bytes)
  const slideNames = zip.names
    .map(name => ({ name, match: /^ppt\/slides\/slide(\d+)\.xml$/.exec(name) }))
    .filter(entry => entry.match !== null)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map(entry => entry.name)
  if (slideNames.length === 0) throw new ExtractError('PowerPoint 文档中没有找到幻灯片。', 'pptx-invalid')

  const blocks = []
  const pages = []
  const warnings = []
  slideNames.forEach((slideName, index) => {
    const xml = zip.text(slideName)
    if (xml === undefined) return
    const shapes = parsePptxShapes(xml)
    let slideTitle = ''
    const slideBlocks = []
    for (const shape of shapes) {
      if (shape.text.length === 0) continue
      if (shape.placeholder === 'title' || shape.placeholder === 'ctrTitle') {
        if (slideTitle === '') slideTitle = shape.text[0]
        for (const para of shape.paragraphs) {
          slideBlocks.push(makeBlock(index, 'heading', para.text, { level: 2 }))
        }
        continue
      }
      for (const para of shape.paragraphs) {
        if (para.text.trim() === '') continue
        const type = para.bullet || shape.paragraphs.length > 1 ? 'list-item' : 'paragraph'
        slideBlocks.push(makeBlock(index, type, para.text, { level: para.level }))
      }
    }
    if (slideTitle === '' && slideBlocks.length > 0) {
      const first = slideBlocks[0]
      slideTitle = first.text
      first.type = 'heading'
      first.level = 2
    }
    const notes = pptxNotes(zip, slideName)
    for (const note of notes) {
      slideBlocks.push(makeBlock(index, 'note', note, { label: '演讲者备注' }))
    }
    blocks.push(...slideBlocks.filter(Boolean))
    pages.push({
      index,
      label: `第 ${index + 1} 张`,
      title: slideTitle,
    })
  })
  if (blocks.length === 0) throw new ExtractError('PowerPoint 文档中没有可提取的文字。', 'pptx-empty')

  const title = inferTitleFromBlocks(zip, blocks, options.name.replace(/\.[^.]+$/, ''))
  return finalizeDocument({
    blocks,
    pages,
    meta: { kind: 'pptx', extension: 'pptx', title, name: options.name, canPreview: Boolean(options.officeAvailable) },
    warnings: options.officeAvailable ? warnings : [...warnings, '未检测到 Office 转 PDF 服务，“原貌”视图不可用；研读视图不受影响。'],
  })
}

export function parsePptxShapes(xml) {
  const shapes = []
  const shapePattern = /<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g
  for (const shapeMatch of xml.matchAll(shapePattern)) {
    const shapeXml = shapeMatch[1]
    const placeholder = /<p:ph[^>]*\btype="([^"]+)"/i.exec(shapeXml)?.[1]
      ?? (/<p:nvPr>\s*<p:ph\b/i.test(shapeXml) ? 'body' : undefined)
    const paragraphs = []
    const paragraphPattern = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g
    for (const paragraphMatch of shapeXml.matchAll(paragraphPattern)) {
      const paragraphXml = paragraphMatch[1]
      const level = Number(/<a:pPr[^>]*\blvl="(\d+)"/i.exec(paragraphXml)?.[1] ?? 0)
      let text = ''
      const tokenPattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g
      for (const token of paragraphXml.matchAll(tokenPattern)) {
        text += token[1] === undefined ? '\n' : decodeXmlEntities(token[1])
      }
      text = cleanInline(text)
      if (text === '') continue
      const bullet = /<a:bu(?:Char|AutoNum|Blip)\b/i.test(paragraphXml) || placeholder === 'body'
      paragraphs.push({ text, level: Number.isInteger(level) ? level : 0, bullet })
    }
    const texts = paragraphs.map(entry => entry.text)
    shapes.push({ placeholder, paragraphs, text: texts })
  }
  return shapes
}

function pptxNotes(zip, slideName) {
  const base = slideName.split('/').pop()
  const relName = `ppt/slides/_rels/${base}.rels`
  const rels = zip.text(relName)
  if (rels === undefined) return []
  const target = /Target="([^"]*notesSlide[^"]*\.xml)"/i.exec(rels)?.[1]
  if (target === undefined) return []
  const normalized = target.startsWith('../')
    ? `ppt/${target.slice(3)}`
    : target.startsWith('/')
      ? target.slice(1)
      : `ppt/notesSlides/${target.split('/').pop()}`
  const xml = zip.text(normalized)
  if (xml === undefined) return []
  const notes = []
  const paragraphPattern = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g
  for (const match of xml.matchAll(paragraphPattern)) {
    let text = ''
    for (const token of match[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
      text += decodeXmlEntities(token[1])
    }
    text = cleanInline(text)
    if (text !== '') notes.push(text)
  }
  return notes.slice(0, 20)
}

// ── Text / Markdown ───────────────────────────────────────────────────────

function decodeTextBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  if (bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) {
    throw new ExtractError('文件包含二进制内容，无法作为文本读取。', 'not-text')
  }
  const utf8 = UTF8.decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  // Chinese plain-text files are often GBK/GB18030. The host Node build has
  // full ICU, so try that legacy decode before accepting replacement glyphs.
  try {
    const gbk = new TextDecoder('gbk').decode(bytes)
    const badUtf8 = (utf8.match(/\uFFFD/g) ?? []).length
    const badGbk = (gbk.match(/\uFFFD/g) ?? []).length
    if (badGbk < badUtf8) return gbk
  } catch {
    // ICU without the legacy encoding: keep the UTF-8 result.
  }
  return utf8
}

function extractText(bytes, options) {
  const raw = decodeTextBytes(bytes)
  const text = raw.replace(/\r\n?/g, '\n')
  const name = options.name
  const extension = extensionOf(name)
  const markdown = extension === 'md' || extension === 'markdown'
  const blocks = []
  if (markdown) {
    const lines = text.split('\n')
    let paragraph = []
    let inFence = false
    let fence = []
    const flushParagraph = () => {
      if (paragraph.length === 0) return
      blocks.push(makeBlock(0, 'paragraph', paragraph.join(' ')))
      paragraph = []
    }
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        if (inFence) {
          blocks.push(makeBlock(0, 'code', fence.join('\n')))
          fence = []
          inFence = false
        } else {
          flushParagraph()
          inFence = true
        }
        continue
      }
      if (inFence) {
        fence.push(line)
        continue
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line)
      if (heading !== null) {
        flushParagraph()
        blocks.push(makeBlock(0, 'heading', heading[2], { level: Math.min(3, heading[1].length) }))
        continue
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flushParagraph()
        blocks.push(makeBlock(0, 'list-item', line.replace(/^\s*([-*+]|\d+[.)])\s+/, '')))
        continue
      }
      if (/^\s*>\s?/.test(line)) {
        flushParagraph()
        blocks.push(makeBlock(0, 'quote', line.replace(/^\s*>\s?/, '')))
        continue
      }
      if (line.trim() === '') {
        flushParagraph()
        continue
      }
      paragraph.push(line.trim())
    }
    flushParagraph()
    if (fence.length > 0) blocks.push(makeBlock(0, 'code', fence.join('\n')))
  } else {
    const paragraphs = text.split(/\n{2,}/)
    for (const value of paragraphs) {
      const cleaned = cleanText(value)
      if (cleaned !== '') blocks.push(makeBlock(0, 'paragraph', cleaned.replace(/\n/g, ' ')))
    }
  }
  if (blocks.length === 0) throw new ExtractError('文本文件没有可显示的正文。', 'text-empty')
  const firstHeading = blocks.find(block => block.type === 'heading')
  const title = firstHeading?.text || name.replace(/\.[^.]+$/, '')
  const pages = assignSections(blocks, 2)
  return finalizeDocument({
    blocks,
    pages,
    meta: { kind: markdown ? 'markdown' : 'text', extension: extension || 'txt', title, name, canPreview: false },
    warnings: [],
  })
}

// ── Entry point ───────────────────────────────────────────────────────────

/**
 * Extract one document.
 * @param {Uint8Array} bytes
 * @param {{ name: string, extension?: string, officeAvailable?: boolean, maxPdfPages?: number, maxPdfChars?: number }} options
 */
export async function extractDocument(bytes, options) {
  const name = options.name
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new ExtractError('文件为空。', 'empty')
  }
  const extension = (options.extension ?? extensionOf(name)).toLowerCase()
  switch (extension) {
    case 'pdf':
      return extractPdf(bytes, { ...options, name })
    case 'docx':
      return extractDocx(bytes, { ...options, name })
    case 'pptx':
      return extractPptx(bytes, { ...options, name })
    case 'md':
    case 'markdown':
    case 'txt':
      return extractText(bytes, { ...options, name })
    default:
      throw new ExtractError(`暂不支持阅读 .${extension || '未知'} 文件。支持 PDF、DOCX、PPTX、Markdown 和纯文本；旧版 DOC/PPT 可在 Office 转换服务可用时打开。`, 'unsupported')
  }
}

export { extensionOf, cleanInline }
