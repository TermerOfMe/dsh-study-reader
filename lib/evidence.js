/**
 * Resolve a citation to source material, NOT verify its factual support.
 *
 * Only [B0], [第 3 页], [第 2 张] are accepted (optional horizontal spaces
 * around Chinese page numbers). IDs are zero-based, physical PDF pages 1-based.
 * Invalid/unavailable references return null. Results contain at most 6 blocks,
 * 6,000 total block-text characters and a 2,400-character quote; truncation is
 * explicit. `textStatus: 'no-text'` means extracted text is unavailable, not
 * that a page is blank. A renderer may still preview pdfPage as an image.
 *
 * Extraction drops empty PDF pages: use page.pdfPage, never page-array indices.
 * PDF labels are a fallback for older extracted PDFs. DOCX logical sections and
 * PPTX slide labels do not prove converted physical-page positions: those
 * references have pdfPage:null unless an explicit page.pdfPage exists.
 * `pageCount` must come from the actual preview renderer; it permits image-only
 * physical references and constrains every resolved physical page. No count is
 * inferred from doc.pages.length, stats.pages, or a largest extracted page.
 * Caller owns authorization, learning boundaries, image loading and navigation.
 */
const MAX_QUOTE = 2400
const MAX_BLOCKS = 6
const MAX_TEXT = 6000
const MAX_BLOCK_TEXT = 1200
const SCAN_PLACEHOLDER = '（此 PDF 没有可提取的文本层，可能是扫描件。请切换到“原貌”查看原文件。）'

const positive = n => Number.isSafeInteger(n) && n > 0
const clip = (text, size) => text.length <= size ? text : `${text.slice(0, Math.max(0, size - 1))}…`
const content = block => typeof block?.text === 'string' && block.text.trim() !== SCAN_PLACEHOLDER ? block.text.trim() : ''
const pageLabel = page => typeof page?.label === 'string' ? clip(page.label, 120) : ''

function physicalPage(doc, page) {
  if (positive(page?.pdfPage)) return page.pdfPage
  if (doc.kind !== 'pdf') return null
  const match = /^第[ \t]*([1-9]\d*)[ \t]*页$/.exec(page?.label ?? '')
  const number = match ? Number(match[1]) : null
  return positive(number) ? number : null
}

/** Pure location resolver. A resolved location is not a verified claim. */
export function resolveEvidence(doc, reference, { pageCount } = {}) {
  if (!doc || !Array.isArray(doc.blocks) || !Array.isArray(doc.pages)
    || typeof reference !== 'string' || reference.length > 64) return null
  if (pageCount !== undefined && !positive(pageCount)) return null
  const ref = reference.trim()
  const match = /^\[B(0|[1-9]\d*)\]$/.exec(ref)
    ?? /^\[第[ \t]*([1-9]\d*)[ \t]*(页|张)\]$/.exec(ref)
  if (!match) return null
  const number = Number(match[1])
  if (!Number.isSafeInteger(number)) return null
  const isBlock = ref.startsWith('[B')
  let selected, pdfPage = null, label, canonical
  const inRange = page => page === null || pageCount === undefined || page <= pageCount
  const idCounts = new Map()
  for (const block of doc.blocks) idCounts.set(block?.id, (idCounts.get(block?.id) ?? 0) + 1)
  const validBlock = block => Number.isSafeInteger(block?.id) && block.id >= 0
    && Number.isSafeInteger(block.page) && block.page >= 0 && block.page < doc.pages.length
    && idCounts.get(block.id) === 1

  if (isBlock) {
    const matches = doc.blocks.filter(block => block?.id === number)
    if (matches.length !== 1 || !validBlock(matches[0])) return null
    selected = matches
    const page = doc.pages[selected[0].page]
    pdfPage = physicalPage(doc, page)
    if (!inRange(pdfPage)) return null
    canonical = `[B${number}]`
    label = `${pageLabel(page) || '正文'} · B${number}`
  } else if (match[2] === '张') {
    const indices = doc.pages.map((page, index) => ({ page, index }))
      .filter(({ page }) => new RegExp(`^第[ \\t]*${number}[ \\t]*张$`).test(page?.label ?? ''))
    if (indices.length !== 1) return null
    pdfPage = physicalPage(doc, indices[0].page)
    if (!inRange(pdfPage)) return null
    selected = doc.blocks.filter(block => block?.page === indices[0].index && validBlock(block))
    canonical = `[第 ${number} 张]`
    label = `第 ${number} 张`
  } else {
    const indices = doc.pages.map((page, index) => ({ page, index }))
      .filter(({ page }) => physicalPage(doc, page) === number)
    // A duplicate explicit mapping is ambiguous, not evidence for a first hit.
    if (indices.length > 1 || (pageCount === undefined && indices.length === 0)
      || (pageCount !== undefined && number > pageCount)) return null
    pdfPage = number
    selected = indices.length ? doc.blocks.filter(block => block?.page === indices[0].index && validBlock(block)) : []
    canonical = `[第 ${number} 页]`
    label = `第 ${number} 页`
  }

  const available = selected.filter(block => content(block))
  const blocks = []
  let remaining = MAX_TEXT
  for (const block of available.slice(0, MAX_BLOCKS)) {
    const text = content(block)
    const excerpt = clip(text, Math.min(MAX_BLOCK_TEXT, remaining))
    blocks.push({ blockId: block.id, text: excerpt, truncated: excerpt !== text })
    remaining -= excerpt.length
    if (remaining <= 0) break
  }
  const fullQuote = blocks.map(block => block.text).join('\n\n')
  const quote = clip(fullQuote, MAX_QUOTE)
  return {
    reference: canonical, label, pdfPage,
    blockId: isBlock ? number : blocks[0]?.blockId ?? null,
    quote, blocks,
    textStatus: available.length ? 'available' : 'no-text',
    truncated: available.length > blocks.length || blocks.some(block => block.truncated) || quote !== fullQuote,
  }
}
