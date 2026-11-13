/**
 * Host half of the Study Reader.
 *
 * Registers one same-origin HTTP surface used by the browser half:
 *   GET  /api/dsh-study/bootstrap
 *   GET  /api/dsh-study/list?path=...
 *   POST /api/dsh-study/open       { path }
 *   POST /api/dsh-study/extract    { docId }   (lazy PDF text extraction)
 *   GET  /api/dsh-study/preview?id=...   (PDF or converted Office, Range-capable)
 *   GET  /api/dsh-study/page?id=...&n=...&w=...  (native PDFium page bitmap)
 *   GET  /api/dsh-study/context?id=...&entry=...  (what one request sent)
 *   GET  /api/dsh-study/context-image?id=...&entry=...&i=... (attached image)
 *   POST /api/dsh-study/ask        NDJSON stream
 *   POST /api/dsh-study/translate  NDJSON stream
 *
 * Documents and answers stay out of the Session log: the reader is a study
 * surface, not a second conversation appended behind the user's back.
 */
import { createHash } from 'node:crypto'
import { readFile, stat as fsStat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, extname, normalize, resolve as resolvePath, sep } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { createCanvas, ImageData, loadImage } from '@napi-rs/canvas'
import { extractDocument, ExtractError } from './extract.js'
import { buildAskPrompt, buildTranslatePrompts, acceptAheadMarker, blockRef, bookMap } from './context.js'
import { ContextLog } from './context-log.js'
import { resolveModel, resolveRequestModel, listConfiguredModels, streamCompletion, LlmUnavailableError } from './llm.js'
import { createReadingSession, answerWithReading } from './reading.js'
import { createReadingPositionStore, validateReadingPosition } from './reading-position.js'
import { createAnnotationStore } from './annotations.js'
import { createConversationStore } from './conversations.js'
import { createAnnotationTool } from './annotation-tool.js'
import { resolveEvidence } from './evidence.js'

const ROUTE_PREFIX = '/api/dsh-study'
const BODY_LIMIT = 1_000_000
const PREVIEW_CACHE_BYTES = 150 * 1024 * 1024
const PAGE_IMAGE_CACHE_BYTES = 192 * 1024 * 1024
let pdfiumLibraryPromise = null

async function getPdfiumLibrary() {
  if (pdfiumLibraryPromise === null) pdfiumLibraryPromise = PDFiumLibrary.init()
  return pdfiumLibraryPromise
}
const VENDOR_PREFIX = '/vendor/pdfjs/'
const requireFromPlugin = createRequire(import.meta.url)
// Single source of truth for the plugin version: the manifest. The browser
// reads it back from /bootstrap instead of carrying its own copy.
const PLUGIN_MANIFEST = requireFromPlugin('../package.json')
const PLUGIN_VERSION = typeof PLUGIN_MANIFEST?.version === 'string' ? PLUGIN_MANIFEST.version : '0.0.0'
let PDFJS_ROOT
try {
  PDFJS_ROOT = dirname(requireFromPlugin.resolve('pdfjs-dist/package.json'))
} catch {
  PDFJS_ROOT = undefined
}
const KATEX_PREFIX = '/vendor/katex/'
let KATEX_ROOT
try { KATEX_ROOT = resolvePath(dirname(requireFromPlugin.resolve('katex/package.json')), 'dist') } catch { KATEX_ROOT = undefined }
const VENDOR_MIME = new Map([
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.bcmap', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
  ['.pfb', 'application/octet-stream'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.icc', 'application/octet-stream'],
  ['.map', 'application/json; charset=utf-8'],
])
const KIND_LABELS = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
  markdown: 'Markdown',
  text: '文本',
}
const LEGACY_OFFICE = new Set(['doc', 'ppt'])
const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'doc', 'ppt'])

export const DEFAULTS = Object.freeze({
  defaultTargetLanguage: 'zh-CN',
  maxDocumentBytes: 64 * 1024 * 1024,
  maxPdfPages: 500,
  maxPdfChars: 2_000_000,
  learningContextChars: 24_000,
  lookaheadChars: 6_000,
  rereadContextChars: 48_000,
  translationContextChars: 6_000,
  maxAnswerTokens: 16384,
  maxTranslationTokens: 1200,
  temperature: 0.3,
  cacheDocuments: 8,
  visionPages: true,
  visionMaxPages: 4,
  annotationDirectory: '',
  readingPositionDirectory: '',
  conversationDirectory: '',
  adaptiveReading: true,
  readingMaxRounds: 3,
  readingMaxPages: 8,
  maxInputTokens: 196608,
  readingTotalTokens: 786432,
})

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function configOf(config) {
  const out = { ...DEFAULTS }
  if (config === null || typeof config !== 'object') return out
  for (const key of Object.keys(DEFAULTS)) {
    const value = config[key]
    if (value !== undefined && value !== null) out[key] = value
  }
  for (const key of ['maxDocumentBytes', 'maxPdfPages', 'maxPdfChars', 'learningContextChars', 'lookaheadChars', 'rereadContextChars', 'translationContextChars', 'maxAnswerTokens', 'maxTranslationTokens', 'cacheDocuments', 'visionMaxPages', 'readingMaxRounds', 'readingMaxPages', 'maxInputTokens', 'readingTotalTokens']) {
    const parsed = Number(out[key])
    if (Number.isFinite(parsed) && parsed > 0) out[key] = Math.floor(parsed)
    else if (['maxDocumentBytes', 'lookaheadChars'].includes(key) && Number.isFinite(parsed) && parsed === 0) out[key] = 0
    else out[key] = DEFAULTS[key]
  }
  const temp = Number(out.temperature)
  out.temperature = Number.isFinite(temp) && temp >= 0 && temp <= 1 ? temp : DEFAULTS.temperature
  if (typeof out.defaultTargetLanguage !== 'string' || out.defaultTargetLanguage.trim() === '') {
    out.defaultTargetLanguage = DEFAULTS.defaultTargetLanguage
  }
  return out
}

// maxDocumentBytes = 0 disables the plugin's own size guard. The Host fs
// service still requires a concrete cap for readBytes, so use the largest
// safe integer as the "no plugin cap" sentinel.
function documentReadLimit(config) {
  return config.maxDocumentBytes > 0 ? config.maxDocumentBytes : Number.MAX_SAFE_INTEGER
}

function extOf(path) {
  return extname(path).slice(1).toLowerCase()
}

function isSupportedExtension(extension) {
  return extension === 'pdf' || OFFICE_EXTENSIONS.has(extension)
}

function kindLabelFor(extension, fallback) {
  if (LEGACY_OFFICE.has(extension)) return `${extension === 'doc' ? 'Word 97-2003' : 'PowerPoint 97-2003'}（已转换）`
  return KIND_LABELS[fallback] ?? KIND_LABELS[extension] ?? '文档'
}

function sha(value) {
  return createHash('sha1').update(value).digest('hex')
}

function sendJson(res, status, value) {
  if (res.writableEnded) return
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

function apiOk(value) {
  return { ok: true, ...value }
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > BODY_LIMIT) throw new HttpError(413, 'body-too-large', '请求内容过大。')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'bad-json', '请求不是有效的 JSON。')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'bad-json', '请求 JSON 必须是对象。')
  }
  return parsed
}

function assertTrusted(req) {
  if (req.method !== 'POST') return
  if (req.headers['x-dsh-study'] !== '1') {
    throw new HttpError(403, 'forbidden', '缺少 Study Reader 请求头。')
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let host
    try { host = new URL(origin).host } catch { host = undefined }
    if (host !== req.headers.host) throw new HttpError(403, 'forbidden', '跨站请求已被拒绝。')
  }
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'forbidden', '跨站请求已被拒绝。')
  }
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'bad-content-type', '请求必须使用 application/json。')
  }
}

class Lru {
  constructor(max, maxBytes, onEvict) {
    this.onEvict = onEvict
    this.max = max
    this.maxBytes = maxBytes
    this.map = new Map()
    this.bytes = 0
  }

  get size() {
    return this.map.size
  }

  get(key) {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key, value) {
    this.delete(key)
    this.map.set(key, value)
    if (value?.bytes !== undefined) this.bytes += value.bytes
    this.trim()
  }

  delete(key) {
    const old = this.map.get(key)
    if (old === undefined) return
    this.map.delete(key)
    if (old?.bytes !== undefined) this.bytes -= old.bytes
  }

  trim() {
    while (this.map.size > this.max || this.bytes > this.maxBytes) {
      const first = this.map.keys().next().value
      if (first === undefined) break
      const value = this.map.get(first)
      this.delete(first)
      this.onEvict?.(value)
    }
  }

  clear() {
    this.map.clear()
    this.bytes = 0
  }
}

function pageNumberOfLabel(label) {
  const match = /第\s*(\d+)\s*页/.exec(String(label ?? ''))
  return match === null ? 0 : Number(match[1])
}

function overviewChapters(doc) {
  const chapters = []
  for (const item of doc.toc ?? []) {
    if (item.level === 1) {
      chapters.push({
        title: item.title,
        page: item.page,
        pageNumber: pageNumberOfLabel(doc.pages[item.page]?.label ?? ''),
        sections: [],
      })
    } else if (item.level === 2 && chapters.length > 0) {
      chapters[chapters.length - 1].sections.push(item.title)
    }
  }
  return chapters
}

class StudyHost {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = configOf(config)
    this.docs = new Lru(this.config.cacheDocuments, 512 * 1024 * 1024, stored => this.retireEntry(stored.entry))
    this.entriesByKey = new Map()
    this.previews = new Lru(4, PREVIEW_CACHE_BYTES)
    this.pageImages = new Lru(24, PAGE_IMAGE_CACHE_BYTES)
    this.briefs = new Map()
    this.briefTasks = new Map()
    this.contextLog = new ContextLog()
    const configuredAnnotations = typeof this.config.annotationDirectory === 'string' ? this.config.annotationDirectory.trim() : ''
    this.annotationStore = createAnnotationStore({ directory: configuredAnnotations || resolvePath(process.env.DSH_PROFILE_DIR || resolvePath(homedir(), '.dsh'), 'data', 'study-reader', 'annotations') })
    const configuredPositions = typeof this.config.readingPositionDirectory === 'string' ? this.config.readingPositionDirectory.trim() : ''
    this.readingPositionStore = createReadingPositionStore({ directory: configuredPositions || resolvePath(process.env.DSH_PROFILE_DIR || resolvePath(homedir(), '.dsh'), 'data', 'study-reader', 'reading-positions') })
    this.conversationStore = createConversationStore({ directory: (typeof this.config.conversationDirectory === 'string' && this.config.conversationDirectory.trim()) || resolvePath(process.env.DSH_PROFILE_DIR || resolvePath(homedir(), '.dsh'), 'data', 'study-reader', 'conversations') })
    this.visionCache = null
    this.active = new Set()
    this.disposed = false
  }

  fs() {
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw new HttpError(503, 'fs-unavailable', '当前 DSH 没有可用的文件系统服务。')
    return fs
  }

  office() {
    return this.ctx.get('officeToPdf')
  }

  defaultDirectory() {
    const home = homedir()
    const workdir = this.ctx.get('workingDirectory')
    if (workdir !== undefined && typeof workdir.defaultDirectory === 'string' && workdir.defaultDirectory !== '') {
      const dir = workdir.defaultDirectory
      // In the desktop profile this fallback is the profile directory itself,
      // which is full of plugin internals rather than the user's documents.
      // Starting at home is the useful default there; the explicit workspace
      // shortcut still opens the recorded directory.
      if (dir === process.env.DSH_PROFILE_DIR || /(?:^|[\\/])\.dsh[\\/](?:profiles|)[\\/]/i.test(dir)) return home
      return dir
    }
    return home
  }

  async bootstrap() {
    const registry = this.ctx.get('workspaceRegistry')
    let workspaces = []
    if (registry !== undefined) {
      try {
        workspaces = registry.list().slice(0, 8).map(workspace => ({
          title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : basename(workspace.path),
          path: workspace.path,
        }))
      } catch {
        workspaces = []
      }
    }
    const preferred = workspaces[0]?.path ?? this.defaultDirectory()
    let dir = preferred
    try {
      const target = await this.fs().resolve(dir)
      const stat = await this.fs().stat(target)
      if (stat?.type !== 'directory') dir = homedir()
    } catch {
      dir = homedir()
    }
    let model
    try {
      model = resolveModel(this.ctx)
    } catch {
      model = undefined
    }
    return {
      defaultDir: dir,
      homeDir: homedir(),
      workspaces,
      model,
      modelAvailable: model !== undefined,
      officeAvailable: this.office() !== undefined,
      pdfjs: PDFJS_ROOT === undefined ? null : {
        module: `${VENDOR_PREFIX}legacy/build/pdf.mjs`,
        worker: `${VENDOR_PREFIX}legacy/build/pdf.worker.mjs`,
        cMapUrl: `${VENDOR_PREFIX}cmaps/`,
        standardFontDataUrl: `${VENDOR_PREFIX}standard_fonts/`,
        wasmUrl: `${VENDOR_PREFIX}wasm/`,
        iccUrl: `${VENDOR_PREFIX}iccs/`,
      },
      supported: ['pdf', 'docx', 'pptx', 'doc', 'ppt'],
      version: PLUGIN_VERSION,
      pageRenderer: 'pdfium-jpeg',
      defaults: {
        defaultTargetLanguage: this.config.defaultTargetLanguage,
        lookaheadChars: this.config.lookaheadChars,
      },
    }
  }

  async list(inputPath) {
    const fs = this.fs()
    const requested = typeof inputPath === 'string' && inputPath.trim() !== '' ? inputPath.trim() : this.defaultDirectory()
    let target
    try {
      target = await fs.resolve(requested)
    } catch (error) {
      throw new HttpError(404, 'not-found', `无法打开目录：${error instanceof Error ? error.message : String(error)}`)
    }
    let stat
    try {
      stat = await fs.stat(target)
    } catch (error) {
      throw new HttpError(404, 'not-found', `无法读取目录：${error instanceof Error ? error.message : String(error)}`)
    }
    if (stat === undefined || stat.type !== 'directory') {
      throw new HttpError(400, 'not-directory', '目标不是文件夹。')
    }
    const listing = await fs.listDir(target)
    const entries = []
    for (const entry of listing) {
      const entryPath = entry.target?.displayPath ?? ''
      if (entryPath === '') continue
      const extension = entry.type === 'file' ? extOf(entryPath) : ''
      const supported = entry.type === 'directory' || isSupportedExtension(extension)
      entries.push({
        name: entry.name,
        type: entry.type,
        path: entryPath,
        extension,
        size: entry.size,
        supported,
      })
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    })
    const absolute = target.displayPath ?? requested
    const crumbs = []
    let cursor = absolute
    for (let depth = 0; depth < 64; depth += 1) {
      const name = basename(cursor) || cursor
      crumbs.unshift({ name, path: cursor })
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
    const parent = dirname(absolute)
    return {
      path: absolute,
      parent: parent === absolute ? null : parent,
      crumbs,
      entries: entries.slice(0, 800),
      truncated: entries.length > 800,
    }
  }

  async open(input) {
    if (typeof input.path !== 'string' || input.path.trim() === '') {
      throw new HttpError(400, 'bad-path', '请提供要打开的文件路径。')
    }
    const path = input.path.trim()
    const extension = extOf(path)
    if (!isSupportedExtension(extension)) {
      throw new HttpError(415, 'unsupported', `暂不支持 .${extension || '无扩展名'} 文件。支持 PDF、DOCX、PPTX、DOC 和 PPT。`)
    }
    const fs = this.fs()
    let target
    try {
      target = await fs.resolve(path)
    } catch (error) {
      throw new HttpError(404, 'not-found', `无法打开文件：${error instanceof Error ? error.message : String(error)}`)
    }
    let stat
    try {
      stat = await fs.stat(target)
    } catch (error) {
      throw new HttpError(404, 'not-found', `无法读取文件：${error instanceof Error ? error.message : String(error)}`)
    }
    if (stat === undefined) throw new HttpError(404, 'not-found', '文件不存在。')
    if (stat.type !== 'file') throw new HttpError(400, 'not-file', '目标不是普通文件。')
    const size = stat.size ?? 0
    const readLimit = this.config.maxDocumentBytes > 0 ? this.config.maxDocumentBytes : Math.max(size + 1, 1)
    if (this.config.maxDocumentBytes > 0 && size > readLimit) {
      throw new HttpError(413, 'too-large', `文件大小 ${formatBytes(size)} 超过阅读上限 ${formatBytes(this.config.maxDocumentBytes)}。`)
    }
    if (LEGACY_OFFICE.has(extension) && this.office() === undefined) {
      throw new HttpError(415, 'office-unavailable', `打开 .${extension} 需要 DSH 的 Office 转 PDF 服务，当前未启用。请另存为 .${extension}x 后重试。`)
    }
    const version = String(stat.version)
    const key = `${target.targetKey}\u0000${version}`
    const cached = this.entriesByKey.get(key)
    if (cached !== undefined && this.docs.get(cached.doc.id) !== undefined) {
      return this.publicDoc(cached.doc)
    }

    // PDFs are opened without reading or extracting the whole file. The
    // original view can use PDF.js range requests immediately; the text
    // extraction used by TOC/Q&A runs through /extract afterwards.
    if (extension === 'pdf') {
      const id = sha(key).slice(0, 24)
      const absolutePath = target.displayPath ?? path
      const doc = {
        kind: 'pdf',
        title: basename(path).replace(/\.[^.]+$/, '') || basename(path),
        pages: [],
        blocks: [],
        toc: [],
        stats: { chars: 0, pages: 0, blocks: 0 },
        warnings: [],
        id,
        path: absolutePath,
        name: basename(path),
        extension,
        format: 'pdf',
        version,
        size,
        converted: false,
        kindLabel: kindLabelFor(extension, 'pdf'),
        canPreview: true,
        openTarget: { target, version, size, extension },
        extraction: 'pending',
      }
      const entry = { doc }
      this.entriesByKey.set(key, entry)
      this.docs.set(id, { bytes: 0, doc, entry })
      if (this.entriesByKey.size > Math.max(32, this.config.cacheDocuments * 4)) {
        for (const [entryKey, value] of this.entriesByKey) {
          if (this.docs.get(value.doc.id) === undefined) this.entriesByKey.delete(entryKey)
        }
      }
      return this.publicDoc(doc)
    }

    const controller = new AbortController()
    const bytes = await fs.readBytes(target, controller.signal, readLimit)
    let extracted
    let converted = false
    if (LEGACY_OFFICE.has(extension)) {
      const pdf = await this.toOfficePdf({ target, version, size, extension }, controller.signal)
      extracted = await extractDocument(pdf, {
        name: `${path.replace(/\.[^.]+$/, '')}.pdf`,
        extension: 'pdf',
        officeAvailable: true,
        maxPdfPages: this.config.maxPdfPages,
        maxPdfChars: this.config.maxPdfChars,
      })
      converted = true
    } else {
      try {
        extracted = await extractDocument(bytes, {
          name: basename(path),
          extension,
          officeAvailable: this.office() !== undefined,
          maxPdfPages: this.config.maxPdfPages,
          maxPdfChars: this.config.maxPdfChars,
        })
      } catch (error) {
        // A malformed or highly unusual OOXML package can still be readable
        // through LibreOffice. Fall back to the visual conversion path rather
        // than refusing the document outright.
        if ((extension === 'docx' || extension === 'pptx') && this.office() !== undefined && error instanceof ExtractError) {
          const pdf = await this.toOfficePdf({ target, version, size, extension }, controller.signal)
          extracted = await extractDocument(pdf, {
            name: `${path.replace(/\.[^.]+$/, '')}.pdf`,
            extension: 'pdf',
            officeAvailable: true,
            maxPdfPages: this.config.maxPdfPages,
            maxPdfChars: this.config.maxPdfChars,
          })
          extracted.warnings.unshift('结构化解析未成功，已改为从原貌 PDF 中提取文字。')
          converted = true
        } else {
          throw error
        }
      }
    }

    const id = sha(key).slice(0, 24)
    const absolutePath = target.displayPath ?? path
    const doc = {
      ...extracted,
      id,
      path: absolutePath,
      name: basename(path),
      extension,
      format: extracted.kind,
      version,
      size,
      converted,
      kindLabel: kindLabelFor(extension, extracted.kind),
      canPreview: extension === 'pdf' || (OFFICE_EXTENSIONS.has(extension) && this.office() !== undefined),
      openTarget: { target, version, size, extension },
    }
    const entry = { doc }
    this.entriesByKey.set(key, entry)
    this.docs.set(id, { bytes: extracted.stats.chars * 2, doc, entry })
    if (this.entriesByKey.size > Math.max(32, this.config.cacheDocuments * 4)) {
      for (const [entryKey, value] of this.entriesByKey) {
        if (this.docs.get(value.doc.id) === undefined) this.entriesByKey.delete(entryKey)
      }
    }
    return this.publicDoc(doc)
  }

  publicDoc(doc) {
    const { openTarget, ...rest } = doc
    return rest
  }

  entryDoc(docId) {
    if (typeof docId !== 'string' || docId === '') throw new HttpError(400, 'bad-doc', '缺少文档标识。')
    const stored = this.docs.get(docId)
    if (stored === undefined) throw new HttpError(404, 'doc-expired', '文档缓存已失效，请重新打开文件。')
    return stored.entry
  }

  retireEntry(entry) {
    entry.retired = true
    for (const [key, value] of this.entriesByKey) if (value === entry) this.entriesByKey.delete(key)
    this.releaseRetired(entry)
  }

  releaseRetired(entry) {
    if (!entry.retired || entry.pdfiumLeases > 0 || entry.pdfiumPromise) return
    try { entry.pdfium?.document?.destroy?.() } catch { /* already closed */ }
    entry.pdfium = undefined
  }

  async withPdfium(entry, operation) {
    if (entry.retired || this.disposed) throw new HttpError(404, 'doc-expired', '文档缓存已失效，请重新打开文件。')
    entry.pdfiumLeases = (entry.pdfiumLeases ?? 0) + 1
    try { return await operation(await this.pdfiumFor(entry)) }
    finally { entry.pdfiumLeases -= 1; this.releaseRetired(entry) }
  }

  async pdfiumFor(entry) {
    if (entry.pdfium !== undefined) return entry.pdfium
    if (entry.pdfiumPromise !== undefined) return entry.pdfiumPromise
    entry.pdfiumPromise = (async () => {
      const doc = entry.doc
      const fs = this.fs()
      const limit = this.config.maxDocumentBytes > 0
        ? this.config.maxDocumentBytes
        : Math.max(doc.size + 1, 1)
      const controller = new AbortController()
      const bytes = doc.extension === 'pdf'
        ? await fs.readBytes(doc.openTarget.target, controller.signal, limit)
        : (await this.preview(doc.id, controller.signal)).bytes
      const library = await getPdfiumLibrary()
      const document = await library.loadDocument(new Uint8Array(bytes))
      const pdfium = { document, pageCount: document.getPageCount() }
      entry.pdfium = pdfium
      return pdfium
    })()
    try {
      return await entry.pdfiumPromise
    } finally {
      entry.pdfiumPromise = undefined
    }
  }

  async rawPage(req, res, url) {
    const id = url.searchParams.get('id') ?? ''
    const requestedPage = Number(url.searchParams.get('n'))
    const requestedWidth = Number(url.searchParams.get('w'))
    const width = Number.isFinite(requestedWidth) && requestedWidth > 0
      ? Math.min(3000, Math.max(200, Math.floor(requestedWidth)))
      : 1200
    const entry = this.entryDoc(id)
    const doc = entry.doc
    if (!doc.canPreview) throw new HttpError(415, 'page-image-unavailable', '此文档没有可用页面预览。')
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      throw new HttpError(400, 'bad-page', '无效的页码。')
    }
    this.sendPageImage(res, await this.pageImage(entry, requestedPage, width))
  }

  /** Render one PDF page to a cached JPEG record (also used as model input). */
  async pageImage(entry, requestedPage, width = 1200) {
    const doc = entry.doc
    const cacheKey = `${doc.id}\u0000${doc.version}\u0000${requestedPage}\u0000${width}`
    const cached = this.pageImages.get(cacheKey)
    if (cached !== undefined) return cached
    return this.withPdfium(entry, async pdfium => {
    if (requestedPage > pdfium.pageCount) throw new HttpError(404, 'bad-page', '页码超出文档范围。')
    const page = pdfium.document.getPage(requestedPage - 1)
    try {
      const original = page.getOriginalSize()
      if (!(original.originalWidth > 0) || !(original.originalHeight > 0)) throw new Error('PDF 页面尺寸无效。')
      // A zoomed, unusually tall page must not allocate an unbounded bitmap.
      const scale = Math.min(width / original.originalWidth, Math.sqrt(12_000_000 / (original.originalWidth * original.originalHeight)))
      const image = await page.render({ scale })
      const canvas = createCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.putImageData(new ImageData(
        new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength),
        image.width,
        image.height,
      ), 0, 0)
      const jpeg = canvas.toBuffer('image/jpeg', 90)
      const record = {
        data: jpeg,
        contentType: 'image/jpeg',
        width: image.width,
        height: image.height,
        bytes: jpeg.byteLength,
      }
      this.pageImages.set(cacheKey, record)
      return record
    } finally {
      try { page.close() } catch { /* ignore */ }
    }
    })
  }

  sendPageImage(res, record) {
    if (res.writableEnded || res.destroyed) return
    res.writeHead(200, {
      'Content-Type': record.contentType ?? 'application/octet-stream',
      'Content-Length': record.data.byteLength,
      'X-Page-Width': record.width,
      'X-Page-Height': record.height,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(Buffer.from(record.data))
  }

  async requestModel(selection) {
    try { return await resolveRequestModel(this.ctx, selection) } catch (error) {
      if (error.code === 'bad-model-selection') throw new HttpError(400, error.code, error.message)
      throw error
    }
  }

  async visionReady(selection, signal) {
    try {
      const { provider, model } = selection ?? resolveModel(this.ctx)
      const key = `${provider}\u0000${model}`
      if (this.visionCache !== null && this.visionCache.key === key) return this.visionCache.ready
      let ready = false
      try {
        const llm = this.ctx.get('llm')
        const info = await llm?.resolveModelInfo(provider, model, signal)
        ready = Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
        if (!Array.isArray(info?.inputModalities)) {
          // Some adapters only advertise modalities through the catalog.
          const models = await llm?.listModels(provider)
          const entry = Array.isArray(models) ? models.find(item => item.id === model) : undefined
          ready = Array.isArray(entry?.inputModalities) && entry.inputModalities.includes('image')
        }
      } catch { ready = false }
      this.visionCache = { key, ready }
      return ready
    } catch {
      return false
    }
  }

  normalizeCrop(input) {
    if (input === null || typeof input !== 'object') return undefined
    const number = key => Number(input[key])
    const x = number('x')
    const y = number('y')
    const width = number('width')
    const height = number('height')
    if (![x, y, width, height].every(Number.isFinite)) return undefined
    if (x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0) return undefined
    return {
      x,
      y,
      width: Math.min(width, 1 - x),
      height: Math.min(height, 1 - y),
    }
  }

  /** Crop a rendered page to the normalized selection box, with a little padding. */
  async renderCrop(entry, pageNumber, crop, width = 1600) {
    const record = await this.pageImage(entry, pageNumber, width)
    const image = await loadImage(record.data)
    if (!(image.width > 0) || !(image.height > 0)) throw new Error('页面图像无效。')
    const padX = Math.min(0.03, (1 - crop.width) * 0.15)
    const padY = Math.min(0.02, (1 - crop.height) * 0.15)
    const sx = Math.max(0, Math.floor((crop.x - padX) * image.width))
    const sy = Math.max(0, Math.floor((crop.y - padY) * image.height))
    const sw = Math.max(8, Math.min(image.width - sx, Math.ceil((crop.width + padX * 2) * image.width)))
    const sh = Math.max(8, Math.min(image.height - sy, Math.ceil((crop.height + padY * 2) * image.height)))
    // Tiny crops are unreadable for the model; upscale them to at least 320px.
    const outWidth = Math.min(1400, Math.max(320, sw))
    const outHeight = Math.max(1, Math.round(sh * outWidth / sw))
    const canvas = createCanvas(outWidth, outHeight)
    const context = canvas.getContext('2d')
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, sx, sy, sw, sh, 0, 0, outWidth, outHeight)
    const jpeg = canvas.toBuffer('image/jpeg', 92)
    return {
      data: jpeg,
      contentType: 'image/jpeg',
      width: outWidth,
      height: outHeight,
      bytes: jpeg.byteLength,
    }
  }

  async cropForModel(entry, pageNumber, crop, width = 1600) {
    const attachments = this.ctx.get('attachments')
    const record = await this.renderCrop(entry, pageNumber, crop, width)
    if (attachments === undefined) return { record }
    const ref = await attachments.saveImage({
      data: record.data,
      mediaType: record.contentType,
      name: `${entry.doc.name} · 第 ${pageNumber} 页框选`,
    })
    return { ref, record }
  }

  async pageForModel(entry, pageNumber, width = 1200) {
    const attachments = this.ctx.get('attachments')
    const record = await this.pageImage(entry, pageNumber, width)
    if (attachments === undefined) return { record }
    const ref = await attachments.saveImage({
      data: record.data,
      mediaType: record.contentType ?? 'image/jpeg',
      name: `${entry.doc.name} · 第 ${pageNumber} 页`,
    })
    return { ref, record }
  }

  async pageAttachment(entry, pageNumber, width = 1200) {
    const packed = await this.pageForModel(entry, pageNumber, width)
    return packed.ref
  }

  pdfPageOfBlock(doc, anchor) {
    const block = doc.blocks[anchor]
    const page = pageNumberOfLabel(doc.pages[block?.page]?.label ?? '')
    return page > 0 ? page : 1
  }

  augmentForImages(built, pages, currentPage, cropPage) {
    const list = pages.map((page, index) => {
      if (cropPage !== undefined && index === 0) return `第 1 张：用户框选的区域截图（第 ${page} 页）`
      return `第 ${index + 1} 张：第 ${page} 页${page === currentPage ? '（当前页）' : ''}`
    }).join('\n')
    built.system += '\n\n本次还会附上 PDF 页面图片。图片中的文字是可靠原文；文字上下文可能缺失、乱码或过时，冲突时以图片为准。引用页面内容时标注 [第 N 页]。'
    if (cropPage !== undefined) {
      built.system += ' 第一张图片是用户主动框选的区域，代表用户引用的原文，回答应优先围绕它。'
    }
    built.prompt += `\n\n# 页面图片\n随后按顺序附上以下页面图片：\n${list}\n请先阅读图片，再回答问题；不要在回答中复述本说明。`
  }

  structuralBrief(doc) {
    const chapters = overviewChapters(doc)
    if (chapters.length === 0) return '# 全书结构\n（目录为空，无法生成章节概览。）\n'
    const lines = ['# 全书结构']
    chapters.forEach((chapter, index) => {
      lines.push(`## ${index + 1}. ${chapter.title}${chapter.pageNumber > 0 ? `（第 ${chapter.pageNumber} 页）` : ''}`)
      if (chapter.sections.length > 0) lines.push(...chapter.sections.slice(0, 8).map(section => `- ${section}`))
    })
    lines.push('', '（当前模型或文档不支持页面图片，以上只是目录结构，不是正文内容。）')
    return `${lines.join('\n')}\n`
  }

  /**
   * Build (and cache) a chapter-by-chapter content brief from outline titles,
   * section names and each chapter's opening page image. Batched to respect
   * the attachment service's per-message image limit.
   */
  async generateBrief(entry, { signal, onBatch, onProgress, onContext, onReasoning, modelSelection }) {
    const doc = entry.doc
    const chapters = overviewChapters(doc)
    if (chapters.length === 0) {
      const text = this.structuralBrief(doc)
      onBatch?.(text)
      this.briefs.set(doc.id, text)
      return text
    }
    const attachments = this.ctx.get('attachments')
    const limit = Math.max(1, Math.min(6, Number(attachments?.imageLimits?.maxImagesPerMessage) || 4))
    const batchCount = Math.ceil(chapters.length / limit)
    let output = ''
    for (let start = 0; start < chapters.length; start += limit) {
      const batch = chapters.slice(start, start + limit)
      onProgress?.(`正在阅读第 ${start + 1}–${start + batch.length} 章…`)
      const parts = []
      batch.forEach((chapter, offset) => {
        const number = start + offset + 1
        parts.push(`## ${number}. ${chapter.title}${chapter.pageNumber > 0 ? `（第 ${chapter.pageNumber} 页）` : ''}\n${chapter.sections.slice(0, 8).map(section => `- ${section}`).join('\n') || '（无小节）'}`)
      })
      const chapterImages = []
      const imageMeta = []
      for (const chapter of batch) {
        if (chapter.pageNumber <= 0) continue
        try {
          const packed = await this.pageForModel(entry, chapter.pageNumber)
          if (packed.ref !== undefined) {
            chapterImages.push(packed.ref)
            imageMeta.push({
              kind: 'page',
              page: chapter.pageNumber,
              width: packed.record.width,
              height: packed.record.height,
              bytes: packed.record.bytes,
            })
          }
        } catch { /* page image unavailable */ }
      }
      const system = [
        '你是阅读助教。下面给出若干章的目录、小节名，以及每章首页的图片。',
        '请用简体中文逐章概括这一章讲什么：每章 2–3 句，突出主题、核心概念和它与其他章的关系。',
        '只能依据给出的目录和图片，不要编造；图片缺失时只根据标题和小节谨慎概括。',
        '严格按下面格式输出，不要写前言、总结或其他内容：',
        '## 第 N 章 标题',
        '概括……',
      ].join('\n')
      const prompt = `# 章节资料\n${parts.join('\n\n')}\n\n请逐章概括。`
      onContext?.({
        system,
        prompt,
        images: imageMeta,
        batchIndex: Math.floor(start / limit) + 1,
        batchCount,
        chapters: batch.map(chapter => chapter.title),
      })
      const result = await streamCompletion({
        ctx: this.ctx,
        system,
        prompt,
        maxTokens: 1_200,
        temperature: 0.2,
        signal,
        images: chapterImages,
        modelSelection,
        onReasoning,
      })
      const text = `${result.text.trim()}\n\n`
      output += text
      onBatch?.(text)
    }
    const brief = output.trim() ? `${output.trim()}\n` : this.structuralBrief(doc)
    this.briefs.set(doc.id, brief)
    return brief
  }

  /**
   * Warm the book brief without blocking the current answer. The next ask in
   * re-reading mode will pick up the cached result.
   */
  startBrief(entry) {
    const doc = entry.doc
    if (this.disposed || this.briefs.has(doc.id) || this.briefTasks.has(doc.id)) return
    if (overviewChapters(doc).length === 0) return
    const task = this.generateBrief(entry, {})
      .catch(error => console.warn('[study-reader] background brief failed:', error))
      .finally(() => this.briefTasks.delete(doc.id))
    this.briefTasks.set(doc.id, task)
  }

  async answerOverview(input, res, req) {
    await this.ensureExtracted(input.docId)
    const entry = this.entryDoc(input.docId)
    const doc = entry.doc
    const model = await this.requestModel(input.modelSelection)
    const controller = this.newController(req, res)
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    const send = frame => this.writeFrame(res, frame)
    let contextEntry
    let overviewReasoning = ''
    const sendMeta = () => send({
      type: 'meta',
      mode: 'overview',
      provider: model.provider,
      model: model.model,
      ...(contextEntry !== undefined ? { contextId: contextEntry.id } : {}),
    })
    try {
      const cached = this.briefs.get(doc.id)
      if (cached !== undefined) {
        sendMeta()
        send({ type: 'delta', text: cached })
        send({ type: 'done', chars: cached.length })
        return
      }
      const vision = this.config.visionPages && doc.extension === 'pdf' && await this.visionReady(model, controller.signal)
      if (!vision) {
        sendMeta()
        const text = this.structuralBrief(doc)
        this.briefs.set(doc.id, text)
        send({ type: 'delta', text })
        send({ type: 'done', chars: text.length })
        return
      }
      if (overviewChapters(doc).length === 0) {
        sendMeta()
        const text = this.structuralBrief(doc)
        this.briefs.set(doc.id, text)
        send({ type: 'delta', text })
        send({ type: 'done', chars: text.length })
        return
      }
      contextEntry = this.contextLog.record({
        docId: doc.id,
        docTitle: doc.title,
        kind: 'ask',
        mode: 'overview',
        provider: model.provider,
        model: model.model,
        system: '',
        prompt: '',
        images: [],
        notes: {
          anchorLabel: '全书',
          contextChars: 0,
          historyChars: 0,
          trimmed: false,
          full: false,
          briefInjected: false,
          vision: true,
          overviewBatches: 0,
          maxTokens: 1_200,
          temperature: 0.2,
        },
      })
      sendMeta()
      const text = await this.generateBrief(entry, {
        modelSelection: model,
        signal: controller.signal,
        onProgress: status => send({ type: 'status', text: status }),
        onBatch: batch => send({ type: 'delta', text: batch }),
        onReasoning: delta => {
          overviewReasoning += delta
          send({ type: 'reasoning', text: delta })
        },
        onContext: ({ system, prompt, images, batchIndex, batchCount }) => {
          // The overview is generated in batches. Record all batches in one
          // entry so the answer can show the complete input, not just part 1.
          const separator = batchIndex > 1 ? `\n\n===== 第 ${batchIndex} / ${batchCount} 批 =====\n\n` : ''
          contextEntry.system += separator + system
          contextEntry.prompt += separator + prompt
          for (const image of images) {
            contextEntry.images.push({ ...image, index: contextEntry.images.length, current: false })
          }
          contextEntry.notes.overviewBatches = batchIndex
          contextEntry.notes.overviewBatchCount = batchCount
          contextEntry.notes.contextChars += prompt.length
        },
      })
      this.contextLog.finish(contextEntry, { status: 'done', reasoning: overviewReasoning })
      send({ type: 'done', chars: text.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (contextEntry !== undefined) {
        this.contextLog.finish(contextEntry, {
          status: controller.signal.aborted === true ? 'aborted' : 'error',
          reasoning: overviewReasoning,
          error: message,
        })
      }
      if (error.partialText) send({ type: 'delta', text: error.partialText })
      if (controller.signal.aborted === true || error.aborted === true) send({ type: 'aborted', code: 'ABORTED', finishReason: 'aborted' })
      else send({ type: 'error', message, code: error.code || 'STREAM_ERROR', finishReason: error.finishReason, partial: error.partial === true, usage: error.usage })
    } finally {
      if (contextEntry !== undefined) {
        this.contextLog.finish(contextEntry, {
          status: controller.signal.aborted === true ? 'aborted' : 'error',
          reasoning: overviewReasoning,
          error: controller.signal.aborted === true ? '已停止生成。' : '请求未完成。',
        })
      }
      this.finishStream(controller, res)
    }
  }

  async ensureExtracted(docId) {
    const entry = this.entryDoc(docId)
    const doc = entry.doc
    if (doc.extraction !== 'pending') return doc
    if (entry.extractionPromise !== null && entry.extractionPromise !== undefined) {
      return entry.extractionPromise
    }
    entry.extractionPromise = this.extractEntry(entry).finally(() => {
      entry.extractionPromise = null
    })
    return entry.extractionPromise
  }

  async extractEntry(entry) {
    const doc = entry.doc
    try {
      const fs = this.fs()
      const limit = this.config.maxDocumentBytes > 0
        ? this.config.maxDocumentBytes
        : Math.max(doc.size + 1, 1)
      const controller = new AbortController()
      const bytes = await fs.readBytes(doc.openTarget.target, controller.signal, limit)
      const extracted = await extractDocument(bytes, {
        name: doc.name,
        extension: 'pdf',
        officeAvailable: this.office() !== undefined,
        maxPdfPages: this.config.maxPdfPages,
        maxPdfChars: this.config.maxPdfChars,
      })
      const merged = {
        ...doc,
        ...extracted,
        id: doc.id,
        path: doc.path,
        name: doc.name,
        extension: doc.extension,
        version: doc.version,
        size: doc.size,
        converted: doc.converted,
        kindLabel: doc.kindLabel,
        canPreview: doc.canPreview,
        openTarget: doc.openTarget,
        extraction: 'ready',
        extractionError: undefined,
      }
      entry.doc = merged
      const stored = this.docs.get(doc.id)
      if (stored !== undefined) {
        stored.doc = merged
        stored.bytes = (extracted.stats?.chars ?? 0) * 2
      }
      return merged
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      doc.extraction = 'error'
      doc.extractionError = message
      doc.warnings = [...(doc.warnings ?? []), `文字提取失败：${message}。原貌阅读仍可使用。`]
      entry.doc = doc
      const stored = this.docs.get(doc.id)
      if (stored !== undefined) stored.doc = doc
      return doc
    }
  }

  async toOfficePdf(input, signal) {
    const office = this.office()
    if (office === undefined) throw new HttpError(503, 'office-unavailable', 'Office 转 PDF 服务不可用。')
    const cacheKey = `${input.target.targetKey}\u0000${input.version}`
    const cached = this.previews.get(cacheKey)
    if (cached !== undefined) return cached.data
    const fs = this.fs()
    let result
    try {
      result = await office.convert({
        extension: input.extension,
        priority: 'foreground',
        source: {
          key: input.target.targetKey,
          version: input.version,
          bytes: input.size,
          read: async (readSignal, maxBytes) => ({
            bytes: await fs.readBytes(input.target, readSignal, Math.min(maxBytes, documentReadLimit(this.config))),
            version: input.version,
          }),
        },
      }, signal)
    } catch (error) {
      throw new HttpError(422, 'office-convert-failed', `Office 文档转换失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const pdf = result.pdf
    if (!(pdf instanceof Uint8Array) || pdf.byteLength === 0) throw new HttpError(422, 'office-convert-failed', 'Office 转 PDF 返回了空文件。')
    this.previews.set(cacheKey, { bytes: pdf.byteLength, data: pdf })
    return pdf
  }

  async preview(docId, signal) {
    const entry = this.entryDoc(docId)
    const doc = entry.doc
    if (!doc.canPreview) throw new HttpError(415, 'preview-unavailable', '此格式没有可用的原貌预览。')
    if (doc.extension === 'pdf') {
      const fs = this.fs()
      const limit = this.config.maxDocumentBytes > 0
        ? this.config.maxDocumentBytes
        : (Number.isFinite(doc.size) ? Math.max(doc.size + 1, 1) : Number.MAX_SAFE_INTEGER)
      const bytes = await fs.readBytes(doc.openTarget.target, signal, limit)
      return { bytes, filename: doc.name, contentType: 'application/pdf' }
    }
    const pdf = await this.toOfficePdf(doc.openTarget, signal)
    return {
      bytes: pdf,
      filename: `${doc.name.replace(/\.[^.]+$/, '')}.pdf`,
      contentType: 'application/pdf',
    }
  }

  async ask(input, res, req) {
    if (input.overview === true) { await this.answerOverview(input, res, req); return }
    const started = Date.now()
    await this.ensureExtracted(input.docId)
    if (res.writableEnded || res.destroyed) return
    const entry = this.entryDoc(input.docId), doc = entry.doc
    if (!doc.blocks.length) throw new HttpError(422, 'text-unavailable', '未能提取可用正文。')
    const question = typeof input.question === 'string' ? input.question.trim() : ''
    if (!question) throw new HttpError(400, 'bad-question', '问题不能为空。')
    if (question.length > 4000) throw new HttpError(413, 'question-too-long', '问题过长，请控制在 4000 字以内。')
    const mode = input.mode === 'reread' ? 'reread' : 'learn'
    const selection = typeof input.selection === 'string' ? input.selection.trim().slice(0, 8000) : ''
    let anchor = Number(input.blockId)
    if (!Number.isInteger(anchor) || anchor < 0 || anchor >= doc.blocks.length) anchor = 0
    const model = await this.requestModel(input.modelSelection)
    const controller = this.newController(req, res)
    const crop = this.normalizeCrop(input.selectionCrop), cropPage = Number(input.selectionPage)
    const currentPage = doc.extension === 'pdf' && Number.isInteger(input.currentPage) && input.currentPage >= 1 && input.currentPage <= doc.pages.length
      ? input.currentPage : this.pdfPageOfBlock(doc, anchor)
    const hasCrop = crop !== undefined && Number.isInteger(cropPage) && cropPage >= 1 && cropPage <= doc.pages.length
    const frontier = mode === 'learn' ? doc.blocks.findLastIndex(block => block.page < currentPage) : doc.blocks.length - 1
    if (mode === 'learn') anchor = Math.min(anchor, frontier)
    const contextDoc = anchor < 0 ? { ...doc, blocks: [{ id: 0, page: currentPage - 1, type: 'paragraph', text: '当前位置及之前没有可提取的正文，请依据用户引用或页面图片；需要时补读已读页面。' }], toc: (doc.toc ?? []).filter(item => item.page < currentPage) } : doc
    const built = buildAskPrompt({ doc: contextDoc, mode, anchorId: Math.max(0, anchor), question, selection, history: input.history, options: this.config })
    if (anchor < 0) built.ahead.ids = []
    const brief = this.briefs.get(doc.id)
    if (brief !== undefined && mode === 'reread') {
      built.prompt += '\n\n# 基于目录与章首页的辅助概览（非全文证据，具体论断须核对原文）\n' + brief.slice(0, 4000)
    }
    const contextEntry = this.contextLog.record({ docId: doc.id, docTitle: doc.title, kind: 'ask', mode,
      provider: model.provider, model: model.model, system: built.system, prompt: built.prompt, images: [],
      notes: { anchor, anchorLabel: anchor >= 0 ? blockRef(doc, doc.blocks[anchor]) : `第 ${currentPage} 页（无可提取正文）`, question, selection,
        contextChars: built.stats.contextChars, trimmed: built.stats.trimmed, full: built.stats.full,
        historyChars: built.stats.historyChars, briefInjected: brief !== undefined && mode === 'reread',
        imagePages: [], plannedPages: [], currentPage, maxTokens: this.config.maxAnswerTokens, temperature: this.config.temperature } })
    contextEntry.at = started
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' })
    res.flushHeaders?.()
    const send = frame => this.writeFrame(res, frame)
    send({ type: 'meta', mode, provider: model.provider, model: model.model, contextId: contextEntry.id })
    let text = '', reasoning = '', markerBuffer = '', scanning = true, session
    const flushFirst = () => { if (markerBuffer) { send({ type: 'delta', text: markerBuffer }); markerBuffer = '' } }
    const scanLine = () => {
      const newline = markerBuffer.indexOf('\n')
      if (newline === -1 && markerBuffer.length <= 500) return
      const id = acceptAheadMarker(markerBuffer.slice(0, newline < 0 ? undefined : newline), built.ahead)
      if (id !== undefined) {
        const block = doc.blocks[id]
        send({ type: 'ahead', blockId: id, page: block.page, label: block.text })
        markerBuffer = newline < 0 ? '' : markerBuffer.slice(newline + 1)
      }
      scanning = false; flushFirst()
    }
    try {
      send({ type: 'status', text: '正在准备引用与文档上下文…' })
      const images = [], imagePages = []
      const vision = this.config.visionPages && doc.extension === 'pdf' && await this.visionReady(model, controller.signal)
      const imageLimit = Math.min(this.config.visionMaxPages, Math.max(1, Number(this.ctx.get('attachments')?.imageLimits?.maxImagesPerMessage) || 4))
      const packImage = async (page, requestedCrop) => {
        if (controller.signal.aborted) throw Object.assign(new Error('已停止生成。'), { aborted: true })
        const normalized = requestedCrop == null ? undefined : this.normalizeCrop(requestedCrop)
        if (requestedCrop != null && normalized === undefined) throw new Error('裁切区域无效。')
        const packed = normalized ? await this.cropForModel(entry, page, normalized) : await this.pageForModel(entry, page)
        return { ...packed, meta: { kind: normalized ? 'crop' : 'page', page, width: packed.record.width, height: packed.record.height,
          bytes: packed.record.bytes, crop: normalized, renderWidth: normalized ? 1600 : 1200, current: page === currentPage } }
      }
      if (hasCrop && !vision && selection === '') throw new Error('当前模型不支持图片，无法读取框选区域；请选择图片模型或引用文字。')
      if (hasCrop && vision) {
        const packed = await packImage(cropPage, crop)
        if (!packed.ref && !selection) throw new Error('框选截图不可用。')
        if (packed.ref) { images.push(packed.ref); imagePages.push(cropPage); contextEntry.images.push({ ...packed.meta, index: 0 }) }
      }
      const currentText = doc.blocks.filter(block => block.page === currentPage - 1).map(block => block.text).join(' ')
      const visualQuestion = /图|表|公式|截图|figure|diagram|equation|chart|image/i.test(question)
      const sparseText = currentText.length < 200 || (/[\u3400-\u9fff]/.test(question) && !/[\u3400-\u9fff]/.test(currentText))
      if (vision && !hasCrop && (visualQuestion || sparseText)) {
        const packed = await packImage(currentPage)
        if (packed.ref) { images.push(packed.ref); imagePages.push(currentPage); contextEntry.images.push({ ...packed.meta, index: contextEntry.images.length }) }
      }
      if (images.length) this.augmentForImages(built, imagePages, currentPage, hasCrop ? cropPage : undefined)
      contextEntry.notes.imagePages = imagePages
      contextEntry.notes.vision = images.length > 0
      if (imagePages.length) send({ type: 'pages', pages: [...new Set(imagePages)] })
      contextEntry.prompt = built.prompt; contextEntry.system = built.system
      session = createReadingSession({ doc, mode, anchor, currentPage, config: this.config, vision,
        imageLimit: Math.max(0, imageLimit - images.length), getImage: packImage, signal: controller.signal,
        onProgress: status => send({ type: 'status', text: status }),
        onTrace: trace => {
          contextEntry.reading.push(trace)
          contextEntry.images = [...contextEntry.images.slice(0, images.length), ...session.images.map((image, index) => ({ ...image, index: images.length + index }))]
          send({ type: 'reading', entry: trace })
          send({ type: 'pages', pages: [...new Set([...imagePages, ...session.seenPages])] })
        } })
      let historyBudget = 12000
      const result = await answerWithReading({ ctx: this.ctx, model, built, images, session, config: this.config, signal: controller.signal,
        fitPrompt: () => {
          historyBudget = Math.max(0, historyBudget - 3000)
          const smaller = buildAskPrompt({ doc: contextDoc, mode, anchorId: Math.max(0, anchor), question, selection, history: input.history,
            options: { ...this.config, historyContextChars: historyBudget, learningContextChars: 4000 } })
          if (images.length) this.augmentForImages(smaller, imagePages, currentPage, hasCrop ? cropPage : undefined)
          contextEntry.prompt = smaller.prompt
          contextEntry.notes.trimmed = true
          contextEntry.notes.historyChars = smaller.stats.historyChars
          contextEntry.notes.contextChars = smaller.stats.contextChars
          contextEntry.notes.briefInjected = false
          built.ahead = smaller.ahead
          if (anchor < 0) built.ahead.ids = []
          return smaller.prompt
        },
        onCall: call => { contextEntry.calls.push(call); contextEntry.notes.inputBudgetTokens = call.inputBudgetTokens },
        onUsage: usage => { contextEntry.usage = usage },
        onReset: () => { text = ''; markerBuffer = ''; scanning = true; send({ type: 'resetText' }) },
        onStatus: status => send({ type: 'status', text: status }),
        onReasoning: delta => { reasoning += delta; send({ type: 'reasoning', text: delta }) },
        onDelta: delta => { text += delta; if (!scanning) send({ type: 'delta', text: delta }); else { markerBuffer += delta; scanLine() } },
      })
      if (scanning) { markerBuffer += '\n'; scanLine() }
      flushFirst()
      this.contextLog.finish(contextEntry, { status: 'done', usage: result.usage, reasoning })
      send({ type: 'done', usage: result.usage, provider: result.provider, model: result.model, chars: text.length })
    } catch (error) {
      flushFirst()
      const aborted = controller.signal.aborted || error.aborted
      const message = error instanceof Error ? error.message : String(error)
      this.contextLog.finish(contextEntry, { status: aborted ? 'aborted' : 'error', reasoning, error: message })
      send(aborted ? { type: 'aborted', code: 'ABORTED', finishReason: 'aborted' } : { type: 'error', message,
        code: error.code || 'STREAM_ERROR', finishReason: error.finishReason, partial: Boolean(text || reasoning || error.partial), usage: contextEntry.usage || error.usage })
    } finally {
      this.finishStream(controller, res)
    }
  }

  async translate(input, res, req) {
    await this.ensureExtracted(input.docId)
    if (res.writableEnded || res.destroyed) return
    const entry = this.entryDoc(input.docId)
    const doc = entry.doc
    if (doc.blocks.length === 0) throw new HttpError(422, 'text-unavailable', '未能提取可用的正文；原貌阅读仍可使用。')
    const selection = typeof input.selection === 'string' ? input.selection.trim() : ''
    const crop = this.normalizeCrop(input.selectionCrop)
    const cropPage = Number(input.selectionPage)
    const hasCrop = crop !== undefined && Number.isInteger(cropPage) && cropPage >= 1
    if (selection === '' && !hasCrop) throw new HttpError(400, 'bad-selection', '请先框选要翻译的内容。')
    if (selection.length > 8000) throw new HttpError(413, 'selection-too-long', '选中的内容过长，请控制在 8000 字以内。')
    let blockId = Number(input.blockId)
    if (!Number.isInteger(blockId) || blockId < 0 || blockId >= doc.blocks.length) blockId = 0
    const targetLanguage = typeof input.targetLanguage === 'string' && input.targetLanguage.trim() !== ''
      ? input.targetLanguage.trim().slice(0, 50)
      : this.config.defaultTargetLanguage
    const built = buildTranslatePrompts({
      doc,
      blockId,
      selection,
      targetLanguage,
      options: this.config,
    })
    const model = await this.requestModel(input.modelSelection)
    let images = []
    let imageMeta = []
    if (hasCrop && this.config.visionPages && doc.extension === 'pdf') {
      try {
        if (await this.visionReady(model)) {
          const packed = await this.cropForModel(entry, cropPage, crop)
          if (packed.ref !== undefined) {
            images = [packed.ref]
            imageMeta = [{
              kind: 'crop',
              page: cropPage,
              width: packed.record.width,
              height: packed.record.height,
              bytes: packed.record.bytes,
            }]
            built.system += '\n\n本次附带的图片是用户框选的页面区域；请翻译图片中的文字，而不是本说明。'
            built.prompt += '\n\n# 框选区域图片\n随后附上用户框选区域的截图。请翻译其中的文字，保留原文的段落、公式和术语格式。'
          }
        }
      } catch (error) {
        console.warn('[study-reader] translation crop unavailable:', error)
      }
    }
    if (selection === '' && images.length === 0) {
      throw new HttpError(422, 'selection-image-unavailable', '框选区域图片不可用；请重试或改用文字选择。')
    }
    const contextEntry = this.contextLog.record({
      docId: doc.id,
      docTitle: doc.title,
      kind: 'translate',
      mode: 'translate',
      provider: model.provider,
      model: model.model,
      system: built.system,
      prompt: built.prompt,
      images: imageMeta,
      notes: {
        anchor: blockId,
        anchorLabel: blockRef(doc, doc.blocks[blockId]),
        selection,
        contextChars: built.stats?.contextChars ?? 0,
        targetLanguage,
        imagePages: hasCrop ? [cropPage] : [],
        vision: images.length > 0,
        maxTokens: this.config.maxTranslationTokens,
        temperature: 0.1,
      },
    })
    const controller = this.newController(req, res)
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    const send = frame => this.writeFrame(res, frame)
    send({ type: 'meta', targetLanguage, provider: model.provider, model: model.model, blockId, contextId: contextEntry.id })
    let reasoning = ''
    try {
      const result = await streamCompletion({
        ctx: this.ctx,
        modelSelection: model,
        system: built.system,
        prompt: built.prompt,
        maxTokens: this.config.maxTranslationTokens,
        temperature: 0.1,
        signal: controller.signal,
        images,
        onCall: call => { contextEntry.calls.push(call) },
        onUsage: usage => { contextEntry.usage = usage },
        onReasoning: delta => {
          reasoning += delta
          send({ type: 'reasoning', text: delta })
        },
        onDelta: delta => send({ type: 'delta', text: delta }),
      })
      this.contextLog.finish(contextEntry, { status: 'done', usage: result.usage, reasoning: result.reasoning || reasoning })
      send({ type: 'done', provider: result.provider, model: result.model, chars: result.text.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (controller.signal.aborted === true || error.aborted === true) {
        this.contextLog.finish(contextEntry, { status: 'aborted', reasoning, error: message })
        send({ type: 'aborted' })
      } else {
        this.contextLog.finish(contextEntry, { status: 'error', reasoning, error: message })
        send({ type: 'error', message, code: error.code || 'STREAM_ERROR', finishReason: error.finishReason, partial: error.partial === true, usage: contextEntry.usage || error.usage })
      }
    } finally {
      this.contextLog.finish(contextEntry, {
        status: controller.signal.aborted === true ? 'aborted' : 'error',
        reasoning,
        error: controller.signal.aborted === true ? '已停止生成。' : '请求未完成。',
      })
      this.finishStream(controller, res)
    }
  }

  newController(req, res) {
    const controller = new AbortController()
    const abort = () => {
      if (!res.writableEnded) controller.abort()
    }
    // Only the response close is a cancellation signal. An IncomingMessage
    // emits 'close' once its body has been fully read, which is well before
    // the streamed answer finishes.
    res.on('close', abort)
    this.active.add(controller)
    return controller
  }

  finishStream(controller, res) {
    this.active.delete(controller)
    if (!res.writableEnded) res.end()
  }

  writeFrame(res, frame) {
    if (res.writableEnded || res.destroyed === true) return
    res.write(`${JSON.stringify(frame)}\n`)
  }

  async vendor(res, action) {
    const katex = action.startsWith(KATEX_PREFIX)
    const root = katex ? KATEX_ROOT : PDFJS_ROOT
    const prefix = katex ? KATEX_PREFIX : VENDOR_PREFIX
    if (root === undefined) throw new HttpError(503, 'vendor-missing', '阅读组件资源不可用。')
    let relative
    try {
      relative = decodeURIComponent(action.slice(prefix.length))
    } catch {
      throw new HttpError(400, 'bad-path', '无效的组件资源路径。')
    }
    const normalized = normalize(relative).replace(/^([\\/])+/, '')
    if (normalized === '' || normalized.startsWith('..') || normalized.includes(`..${sep}`) || normalized.includes('\u0000')) {
      throw new HttpError(403, 'forbidden', '组件资源路径越界。')
    }
    if (katex && !/^(?:katex\.mjs|katex\.min\.css|fonts[\\/][\w.-]+\.(?:woff2?|ttf))$/.test(normalized)) {
      throw new HttpError(404, 'not-found', '组件资源不存在。')
    }
    const absolute = resolvePath(root, normalized)
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new HttpError(403, 'forbidden', '组件资源路径越界。')
    }
    let info
    try {
      info = await fsStat(absolute)
    } catch {
      throw new HttpError(404, 'not-found', '组件资源不存在。')
    }
    if (!info.isFile()) throw new HttpError(404, 'not-found', '组件资源不存在。')
    const bytes = await readFile(absolute)
    if (res.writableEnded) return
    res.writeHead(200, {
      'Content-Type': VENDOR_MIME.get(extname(absolute).toLowerCase()) ?? 'application/octet-stream',
      'Content-Length': bytes.byteLength,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(bytes)
  }

  previewHeaders(filename, contentType, total, range) {
    const headers = {
      'Content-Type': contentType,
      'Content-Length': total,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (range !== null && range !== undefined) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total}`
    }
    return headers
  }

  sendRangeNotSatisfiable(res, total) {
    res.writeHead(416, {
      'Content-Type': 'application/pdf',
      'Content-Range': `bytes */${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end()
  }

  async streamPdfFile(doc, total, res, signal) {
    const fs = this.fs()
    const chunkSize = 1024 * 1024
    for (let offset = 0; offset < total; offset += chunkSize) {
      if (signal.aborted || res.writableEnded || res.destroyed) return
      const length = Math.min(chunkSize, total - offset)
      const bytes = await fs.readByteRange(doc.openTarget.target, { offset, length }, signal)
      if (signal.aborted || res.writableEnded || res.destroyed) return
      if (bytes.byteLength === 0) break
      if (!res.write(Buffer.from(bytes))) {
        await new Promise(resolve => {
          const done = () => {
            res.off('drain', done)
            res.off('close', done)
            resolve()
          }
          res.on('drain', done)
          res.on('close', done)
        })
      }
    }
    if (!res.writableEnded && !res.destroyed) res.end()
  }

  async rawPreview(req, res, url) {
    const id = url.searchParams.get('id') ?? ''
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    try {
      const entry = this.entryDoc(id)
      const doc = entry.doc
      if (!doc.canPreview) throw new HttpError(415, 'preview-unavailable', '此格式没有可用的原貌预览。')
      if (doc.extension === 'pdf') {
        const total = doc.size
        const range = parseByteRange(req.headers.range, total)
        if (range === 'invalid') {
          this.sendRangeNotSatisfiable(res, total)
          return
        }
        if (range !== null) {
          const bytes = await this.fs().readByteRange(doc.openTarget.target, {
            offset: range.start,
            length: range.length,
          }, controller.signal)
          if (res.writableEnded) return
          const actualEnd = range.start + bytes.byteLength - 1
          const headers = this.previewHeaders(doc.name, 'application/pdf', total, range)
          headers['Content-Length'] = bytes.byteLength
          headers['Content-Range'] = `bytes ${range.start}-${actualEnd}/${total}`
          res.writeHead(206, headers)
          res.end(Buffer.from(bytes))
          return
        }
        // PDF.js aborts its initial full request as soon as it sees
        // Accept-Ranges. Stream the file so that request does not buffer
        // hundreds of megabytes before it can be cancelled.
        res.writeHead(200, this.previewHeaders(doc.name, 'application/pdf', total, null))
        res.flushHeaders?.()
        await this.streamPdfFile(doc, total, res, controller.signal)
        return
      }
      const preview = await this.preview(id, controller.signal)
      if (res.writableEnded) return
      const total = preview.bytes.byteLength
      const range = parseByteRange(req.headers.range, total)
      if (range === 'invalid') {
        this.sendRangeNotSatisfiable(res, total)
        return
      }
      const headers = this.previewHeaders(preview.filename, preview.contentType, total, range)
      if (range !== null) {
        const bytes = preview.bytes.slice(range.start, range.end + 1)
        const actualEnd = range.start + bytes.byteLength - 1
        headers['Content-Length'] = bytes.byteLength
        headers['Content-Range'] = `bytes ${range.start}-${actualEnd}/${total}`
        res.writeHead(206, headers)
        res.end(Buffer.from(bytes))
        return
      }
      res.writeHead(200, headers)
      res.end(Buffer.from(preview.bytes))
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded && !res.destroyed) res.end()
        return
      }
      if (res.destroyed || res.writableEnded) return
      const status = error instanceof HttpError ? error.status : 500
      const code = error instanceof HttpError ? error.code : 'preview-failed'
      sendError(res, status, code, error instanceof Error ? error.message : String(error))
    }
  }

  async conversationsOperation(input, write = false) {
    const entry = this.entryDoc(input.docId)
    try {
      if (!write) return await this.conversationStore.get(entry.doc.path)
      const { docId, ...operation } = input
      return await this.conversationStore.mutate(entry.doc.path, operation)
    } catch (error) {
      if (error.code === 'CONVERSATION_VALIDATION') throw new HttpError(400, error.code, error.message)
      if (error.code === 'CONVERSATION_CORRUPT') throw new HttpError(409, error.code, error.message)
      throw error
    }
  }

  async readingPositionOperation(input, write = false) {
    const entry = this.entryDoc(input?.docId)
    try {
      if (!write) return { position: await this.readingPositionStore.get(entry.doc.path) }
      const position = validateReadingPosition(input.position)
      // Physical preview page counts also cover Office conversion and PDFs whose
      // extracted text page count is incomplete. Reads never trigger rendering.
      const count = await this.withPdfium(entry, pdfium => pdfium.pageCount)
      if (position.pageNumber > count) throw new HttpError(400, 'bad-page', '阅读位置页码超出文档范围。')
      return { position: await this.readingPositionStore.set(entry.doc.path, position, { writerId: input.writerId, revision: input.revision }) }
    } catch (error) {
      if (error.code === 'READING_POSITION_VALIDATION') throw new HttpError(400, error.code, error.message)
      if (error.code === 'READING_POSITION_CORRUPT') throw new HttpError(409, error.code, error.message)
      throw error
    }
  }

  async annotationOperation(input) {
    if (!input || !['list', 'upsert', 'remove'].includes(input.action)) throw new HttpError(400, 'bad-annotation-action', '无效的批注操作。')
    let entry, documentPath
    if (input.docId) {
      entry = this.entryDoc(input.docId)
      documentPath = entry.doc.path
    } else {
      if (typeof input.documentPath !== 'string' || !/^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(input.documentPath)) throw new HttpError(400, 'bad-path', '请提供文档的绝对路径。')
      const target = await this.fs().resolve(input.documentPath)
      const stat = await this.fs().stat(target)
      if (stat?.type !== 'file' || !isSupportedExtension(extOf(input.documentPath))) throw new HttpError(400, 'bad-path', '目标不是支持的文档文件。')
      documentPath = target.displayPath ?? input.documentPath
    }
    try {
      if (input.action === 'list') return { annotations: await this.annotationStore.list(documentPath) }
      if (input.action === 'remove') return { removed: await this.annotationStore.remove(documentPath, input.id) }
      const annotation = input.annotation
      if (Number.isInteger(annotation?.pdfPage)) {
        entry ??= this.entryDoc((await this.open({ path: documentPath })).id)
        const count = await this.withPdfium(entry, pdfium => pdfium.pageCount)
        if (annotation.pdfPage < 1 || annotation.pdfPage > count) throw new HttpError(400, 'bad-page', '批注页码超出文档范围。')
      }
      return { annotation: await this.annotationStore.upsert(documentPath, annotation) }
    } catch (error) {
      if (error.code === 'ANNOTATION_VALIDATION') throw new HttpError(400, error.code, error.message)
      if (error.code === 'ANNOTATION_CORRUPT') throw new HttpError(409, error.code, error.message)
      throw error
    }
  }

  async evidence(url) {
    const id = url.searchParams.get('id') ?? ''
    const entry = this.entryDoc(id)
    const doc = await this.ensureExtracted(id)
    let pageCount
    try { pageCount = await this.withPdfium(entry, pdfium => pdfium.pageCount) } catch { /* textual evidence can still be previewed */ }
    const evidence = resolveEvidence(doc, url.searchParams.get('ref'), { pageCount })
    if (!evidence) throw new HttpError(404, 'evidence-missing', '这条引用无法对应到有效的原文位置。')
    return evidence
  }

  contextEntry(url) {
    const docId = url.searchParams.get('id') ?? ''
    const id = url.searchParams.get('entry') ?? ''
    const entry = this.contextLog.get(docId, id)
    if (entry === undefined) {
      throw new HttpError(404, 'context-missing', '这次请求的上下文记录已不存在（DSH 重启或记录已被新请求覆盖）。')
    }
    return entry
  }

  contextDetail(url) {
    return this.contextLog.publicEntry(this.contextEntry(url))
  }

  async contextImage(res, url) {
    const entry = this.contextEntry(url)
    const index = Number(url.searchParams.get('i'))
    const image = Number.isInteger(index) ? entry.images[index] : undefined
    if (image === undefined) throw new HttpError(404, 'context-image-missing', '这张图片记录不存在。')
    const requestedWidth = Number(url.searchParams.get('w'))
    const previewWidth = Number.isFinite(requestedWidth) && requestedWidth > 0
      ? Math.min(1600, Math.max(200, Math.floor(requestedWidth)))
      : 0
    const docEntry = this.entryDoc(entry.docId)
    if (image.kind === 'crop' && image.crop !== undefined) {
      const renderWidth = previewWidth > 0 ? previewWidth : (image.renderWidth || 1600)
      this.sendPageImage(res, await this.renderCrop(docEntry, image.page, image.crop, renderWidth))
      return
    }
    this.sendPageImage(res, await this.pageImage(docEntry, image.page, previewWidth || image.width || 1200))
  }

  async handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (!url.pathname.startsWith(ROUTE_PREFIX)) {
      sendError(res, 404, 'no-route', '未知的 Study Reader 路由。')
      return
    }
    const action = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    assertTrusted(req)
    if (req.method === 'GET' && action === '/bootstrap') {
      sendJson(res, 200, apiOk(await this.bootstrap()))
      return
    }
    if (req.method === 'GET' && action === '/models') {
      sendJson(res, 200, apiOk(await listConfiguredModels(this.ctx)))
      return
    }
    if (req.method === 'GET' && action === '/conversations') {
      sendJson(res, 200, apiOk(await this.conversationsOperation({ docId: url.searchParams.get('id') })))
      return
    }
    if (req.method === 'POST' && action === '/conversations') {
      sendJson(res, 200, apiOk(await this.conversationsOperation(await readJson(req), true)))
      return
    }
    if (req.method === 'GET' && action === '/list') {
      sendJson(res, 200, apiOk(await this.list(url.searchParams.get('path') ?? '')))
      return
    }
    if (req.method === 'GET' && action === '/preview') {
      await this.rawPreview(req, res, url)
      return
    }
    if (req.method === 'GET' && action === '/page') {
      await this.rawPage(req, res, url)
      return
    }
    if (req.method === 'GET' && action === '/reading-position') {
      sendJson(res, 200, apiOk(await this.readingPositionOperation({ docId: url.searchParams.get('id') })))
      return
    }
    if (req.method === 'POST' && action === '/reading-position') {
      sendJson(res, 200, apiOk(await this.readingPositionOperation(await readJson(req), true)))
      return
    }
    if (req.method === 'GET' && action === '/annotations') {
      sendJson(res, 200, apiOk(await this.annotationOperation({ docId: url.searchParams.get('id'), action: 'list' })))
      return
    }
    if (req.method === 'POST' && action === '/annotations') {
      sendJson(res, 200, apiOk(await this.annotationOperation(await readJson(req))))
      return
    }
    if (req.method === 'GET' && action === '/evidence') {
      sendJson(res, 200, apiOk({ evidence: await this.evidence(url) }))
      return
    }
    if (req.method === 'GET' && action === '/context') {
      sendJson(res, 200, apiOk({ entry: this.contextDetail(url) }))
      return
    }
    if (req.method === 'GET' && action === '/context-image') {
      await this.contextImage(res, url)
      return
    }
    if (req.method === 'GET' && (action.startsWith(VENDOR_PREFIX) || action.startsWith(KATEX_PREFIX))) {
      await this.vendor(res, action)
      return
    }
    if (req.method === 'POST' && action === '/open') {
      sendJson(res, 200, apiOk({ doc: await this.open(await readJson(req)) }))
      return
    }
    if (req.method === 'POST' && action === '/extract') {
      const input = await readJson(req)
      const doc = await this.ensureExtracted(input.docId)
      sendJson(res, 200, apiOk({ doc: this.publicDoc(doc) }))
      return
    }
    if (req.method === 'POST' && action === '/ask') {
      await this.ask(await readJson(req), res, req)
      return
    }
    if (req.method === 'POST' && action === '/translate') {
      await this.translate(await readJson(req), res, req)
      return
    }
    sendError(res, 404, 'no-route', '未知的 Study Reader 路由。')
  }

  dispose() {
    this.disposed = true
    for (const controller of this.active) controller.abort()
    this.active.clear()
    for (const stored of this.docs.map.values()) {
      this.retireEntry(stored.entry)
    }
    this.pageImages.clear()
    this.briefs.clear()
    this.briefTasks.clear()
    this.contextLog.clear()
    this.docs.clear()
    this.previews.clear()
    this.entriesByKey.clear()
  }
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function parseByteRange(header, total) {
  if (typeof header !== 'string' || header === '') return null
  if (!Number.isInteger(total) || total <= 0) return 'invalid'
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return 'invalid'
  const [, startText, endText] = match
  if (startText === '' && endText === '') return 'invalid'
  let start
  let end
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = Number(startText)
    if (!Number.isInteger(start) || start < 0 || start >= total) return 'invalid'
    end = endText === '' ? total - 1 : Number(endText)
    if (!Number.isInteger(end) || end < start) return 'invalid'
    end = Math.min(end, total - 1)
  }
  return { start, end, length: end - start + 1 }
}

export function installStudyHost(ctx, config) {
  const app = new StudyHost(ctx, config)
  ctx.inject?.(['tools'], toolCtx => toolCtx.tools.register(createAnnotationTool(input => app.annotationOperation(input))))
  const dispose = ctx.effect(() => {
    const remove = ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          await app.handle(req, res)
        } catch (error) {
          if (res.writableEnded) return
          if (res.headersSent) {
            res.end()
            return
          }
          if (error instanceof HttpError) {
            sendError(res, error.status, error.code, error.message)
          } else if (error instanceof LlmUnavailableError) {
            sendError(res, 503, 'llm-unavailable', error.message)
          } else if (error instanceof ExtractError) {
            sendError(res, 422, error.code, error.message)
          } else {
            console.error('[study-reader] request failed:', error)
            sendError(res, 500, 'internal', error instanceof Error ? error.message : String(error))
          }
        }
      },
    })
    return () => {
      app.dispose()
      remove()
    }
  })
  return { dispose, app }
}

