/**
 * End-to-end smoke check for the Host half and the context inspector
 * (not shipped). Creates a tiny PDF, drives /open, /extract, /ask and
 * /translate through the registered route, and reads the recorded context.
 *
 * Run with: node scripts/smoke-host.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { installStudyHost } from '../lib/app.js'

function makePdf() {
  const page = (contentId, text) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${contentId} 0 R >>`
  const stream = text => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  const contents = 'BT /F1 18 Tf 72 720 Td (Hello world from page one.) Tj ET'
  const contents2 = 'BT /F1 18 Tf 72 720 Td (Second page text.) Tj ET'
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    page(4, contents),
    stream(contents),
    page(6, contents2),
    stream(contents2),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Outlines /First 9 0 R /Last 10 0 R /Count 2 >>',
    '<< /Title (Chapter One) /Parent 8 0 R /Dest [3 0 R /Fit] /Next 10 0 R >>',
    '<< /Title (Chapter Two) /Parent 8 0 R /Prev 9 0 R /Dest [5 0 R /Fit] >>',
  ]
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets = [0]
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = header.length + body.length
    body += `${index} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = header.length + body.length
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let index = 1; index < objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}

const pdf = makePdf()
let attachmentId = 0

const fs = {
  async resolve(path) {
    if (path.includes('denied')) throw new Error('Access denied by test filesystem')
    const displayPath = /^[a-z]:[\\/]/i.test(path) ? path : `C:\\tmp\\${path}`
    return { targetKey: `test:${displayPath}`, displayPath }
  },
  async stat() {
    return { type: 'file', size: pdf.byteLength, version: 'v1' }
  },
  async readBytes() {
    return pdf
  },
  async readByteRange(_target, range) {
    return pdf.subarray(range.offset, range.offset + range.length)
  },
  async listDir() {
    return []
  },
}

function asyncChunks(chunks) {
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })()
}

const routedCalls = [], modalityCalls = []
const llm = {
  async listProviders() { return [{ id: 'fake', name: 'Fake' }, { id: 'selected', name: 'Selected' }] },
  async resolveModelInfo(provider, model) {
    modalityCalls.push({ provider, model })
    return { inputModalities: ['image'] }
  },
  async listModels(provider) {
    return [{ provider, id: provider === 'selected' ? 'selected-model' : 'fake-model', name: 'Test model' }]
  },
  stream(options) {
    routedCalls.push({ provider: options.provider, model: options.model })
    if (options.messages?.[0]?.content?.[0]?.text?.includes('ADAPTIVE_TEST')) {
      const results = options.messages.filter(message => message.role === 'tool')
      if (results.length < 2) {
        const name = results.length ? 'document_read' : 'document_search'
        const args = results.length ? { pages: [1], format: 'text', offset: 0, crop: null, reason: 'Verify source' }
          : { query: 'Hello', offset: 0, reason: 'Find definition' }
        return asyncChunks([
          { type: 'text-delta', text: 'Provisional tool preamble' },
          { type: 'block-end', index: 1, block: { type: 'tool-call', id: `read${results.length}`, name, arguments: JSON.stringify(args) } },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
          { type: 'finish', reason: { kind: 'tool-calls' } },
        ])
      }
    }
    if (typeof options.system === 'string' && options.system.includes('阅读助手')) {
      return asyncChunks([
        { type: 'text-delta', text: '{"pages":[]}' },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
    }
    return asyncChunks([
      { type: 'reasoning-delta', text: '先确认这一段在上下文中的位置。' },
      { type: 'text-delta', text: '这是基于当前页面的回答。' },
      { type: 'usage', usage: { inputTokens: 120, outputTokens: 16, reasoningTokens: 9 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  },
}

let registered
let annotationTool
const ctx = {
  inject(names, callback) { if (names.includes('tools')) callback({ tools: { register(definition) { annotationTool = definition; return () => {} } } }) },
  webServer: {
    register(route) {
      registered = route
      return () => { registered = undefined }
    },
  },
  get(name) {
    if (name === 'officeToPdf') return { async convert() { return { pdf } } }
    if (name === 'fs') return fs
    if (name === 'llm') return llm
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) }
    if (name === 'attachments') {
      return {
        imageLimits: { maxImagesPerMessage: 4 },
        async saveImage({ data, mediaType, name }) {
          attachmentId += 1
          return {
            attachmentId: `a${attachmentId}`,
            mediaType,
            bytes: data.length,
            width: 1200,
            height: 1600,
            name,
          }
        },
      }
    }
    if (name === 'webServer') {
      return {
        register(route) {
          registered = route
          return () => { registered = undefined }
        },
      }
    }
    if (name === 'workingDirectory') return { defaultDirectory: process.cwd() }
    if (name === 'workspaceRegistry') return { list: () => [] }
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    return () => { if (typeof dispose === 'function') dispose() }
  },
}

const failures = []
const expect = (condition, message) => {
  if (!condition) failures.push(message)
}

const annotationDirectory = await mkdtemp(join(tmpdir(), 'dsh-study-http-'))
const hostConfig = { maxDocumentBytes: 0, visionMaxPages: 2, annotationDirectory, readingPositionDirectory: join(annotationDirectory, 'positions'), conversationDirectory: join(annotationDirectory, 'conversations') }
let host = installStudyHost(ctx, hostConfig)
const server = createServer((req, res) => {
  if (registered === undefined) {
    res.writeHead(500)
    res.end('no route')
    return
  }
  registered.handler(req, res).catch(error => {
    console.error(error)
    if (!res.headersSent) res.writeHead(500)
    res.end(String(error))
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/dsh-study`
const post = async (path, payload) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-study': '1' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, text }
}
const getJson = async path => {
  const response = await fetch(`${base}${path}`)
  return { status: response.status, body: await response.json().catch(() => undefined) }
}

try {
  for (const [asset, mime] of [['katex.mjs', 'text/javascript'], ['katex.min.css', 'text/css'], ['fonts/KaTeX_Main-Regular.woff2', 'font/woff2']]) {
    const response = await fetch(`${base}/vendor/katex/${asset}`)
    expect(response.status === 200, `math asset ${asset} should load`)
    expect(response.headers.get('content-type')?.startsWith(mime), `math asset ${asset} MIME`)
    expect((await response.arrayBuffer()).byteLength > 0, `math asset ${asset} should not be empty`)
  }
  for (const asset of ['package.json', '..%2f..%2fpackage.json', '%00', 'fonts/not-found.woff2']) {
    const response = await fetch(`${base}/vendor/katex/${asset}`)
    expect(response.status >= 400, `invalid math asset ${asset} rejected`)
    await response.arrayBuffer()
  }
  const opened = await post('/open', { path: 'sample.pdf' })
  expect(opened.status === 200, `open failed: ${opened.text}`)
  const doc = JSON.parse(opened.text).doc
  expect(typeof doc.id === 'string' && doc.id !== '', 'open should return a document id')

  const models = await getJson('/models')
  expect(models.status === 200 && models.body.models.some(item => item.provider === 'selected' && item.model === 'selected-model'), 'configured models endpoint returns provider and model names')
  const emptyConversations = await getJson('/conversations?id=' + doc.id)
  expect(emptyConversations.status === 200 && emptyConversations.body.conversations.length === 0 && emptyConversations.body.activeId === null, 'new document has no conversations')
  const thread = { id: 'thread-1', title: 'Test', messages: [{ id: 'm1', role: 'user', text: 'Hello', unknown: { page: 2 } }], draft: 'draft', quote: null, modelSelection: { provider: 'selected', model: 'selected-model' }, mode: 'learn', createdAt: Date.now(), updatedAt: Date.now() }
  const savedThread = await post('/conversations', { docId: doc.id, action: 'save', conversation: thread, activeId: thread.id })
  expect(savedThread.status === 200 && JSON.parse(savedThread.text).activeId === thread.id, 'conversation saves before extraction')
  const badThread = await post('/conversations', { docId: doc.id, action: 'save', conversation: { ...thread, mode: 'invalid' } })
  expect(badThread.status === 400, 'conversation validation has HTTP 400')
  expect((await getJson('/conversations?id=missing')).status === 404, 'conversation requires loaded document')

  const missingPosition = await getJson('/reading-position?id=' + doc.id)
  expect(missingPosition.status === 200 && missingPosition.body.position === null, 'new document position is null before extraction')
  const savedPosition = await post('/reading-position', { docId: doc.id, position: { pageNumber: 2, x: .25, y: .7 }, writerId: 'smoke', revision: 2 })
  expect(savedPosition.status === 200 && JSON.parse(savedPosition.text).position.pageNumber === 2, 'position saves before text extraction')
  const stalePosition = await post('/reading-position', { docId: doc.id, position: { pageNumber: 1, x: 0, y: 0 }, writerId: 'smoke', revision: 1 })
  expect(stalePosition.status === 200 && JSON.parse(stalePosition.text).position.pageNumber === 2, 'stale lifecycle request cannot overwrite newer position')
  for (const position of [{ pageNumber: 3, x: 0, y: 0 }, { pageNumber: 1, x: -1, y: 0 }, { pageNumber: 1, x: 0, y: 2 }, { pageNumber: 1.5, x: 0, y: 0 }]) {
    const invalid = await post('/reading-position', { docId: doc.id, position })
    expect(invalid.status === 400, 'invalid or out-of-document position rejected')
  }
  expect((await getJson('/reading-position?id=unknown')).status === 404, 'reading position requires a loaded document')
  host.dispose()
  host = installStudyHost(ctx, hostConfig)
  const reopened = await post('/open', { path: 'sample.pdf' })
  expect(reopened.status === 200, 'document reopens after Host restart')
  const restored = await getJson('/reading-position?id=' + JSON.parse(reopened.text).doc.id)
  expect(restored.status === 200 && restored.body.position.pageNumber === 2 && restored.body.position.y === .7, 'position survives Host instance restart')

  const restoredThreads = await getJson('/conversations?id=' + doc.id)
  expect(restoredThreads.status === 200 && restoredThreads.body.conversations[0]?.messages[0]?.unknown.page === 2 && restoredThreads.body.activeId === thread.id, 'conversation survives Host recreation with metadata')
  thread.title = 'Updated'
  await post('/conversations', { docId: doc.id, action: 'save', conversation: thread })
  expect((await getJson('/conversations?id=' + doc.id)).body.conversations[0].title === 'Updated', 'conversation update replaces one record')
  const removedThread = await post('/conversations', { docId: doc.id, action: 'remove', id: thread.id })
  expect(removedThread.status === 200 && JSON.parse(removedThread.text).conversations.length === 0 && JSON.parse(removedThread.text).activeId === null, 'conversation removal clears active selection')

  const extracted = await post('/extract', { docId: doc.id })
  expect(extracted.status === 200, `extract failed: ${extracted.text}`)
  const fullDoc = JSON.parse(extracted.text).doc
  expect(Array.isArray(fullDoc.blocks) && fullDoc.blocks.length > 0, 'extract should produce text blocks')
  expect(Array.isArray(fullDoc.toc) && fullDoc.toc.length === 2, `extract should read the outline: ${JSON.stringify(fullDoc.toc)}`)

  const emptyAnnotations = await getJson('/annotations?id='+doc.id)
  expect(emptyAnnotations.status===200 && emptyAnnotations.body.annotations.length===0, 'annotations start empty')
  const savedResponse = await post('/annotations', {docId:doc.id,action:'upsert',annotation:{type:'highlight',pdfPage:1,quote:'Hello',crop:{x:.1,y:.1,width:.3,height:.05},rects:[{x:.1,y:.1,width:.3,height:.05}],note:'My note',tags:['test']}})
  expect(savedResponse.status===200, 'annotation HTTP save succeeds: '+savedResponse.text)
  const savedAnnotation=JSON.parse(savedResponse.text).annotation
  const toolListed = await annotationTool.execute({action:'list',documentPath:'C:\\tmp\\sample.pdf'})
  expect(toolListed.annotations.some(item=>item.id===savedAnnotation?.id),'tool sees annotation saved through HTTP')
  if(savedAnnotation){
    const edited = await annotationTool.execute({action:'upsert',documentPath:'C:\\tmp\\sample.pdf',annotation:{id:savedAnnotation.id,note:'Edited through tool'}})
    expect(edited.annotation.note==='Edited through tool','tool uses same mutation operation')
    const listed=await getJson('/annotations?id='+doc.id)
    expect(listed.body.annotations[0]?.note==='Edited through tool','HTTP sees tool update')
    const deleted=await post('/annotations',{docId:doc.id,action:'remove',id:savedAnnotation.id})
    expect(deleted.status===200 && JSON.parse(deleted.text).removed,'HTTP removes saved annotation')
  }
  const invalidAnnotation=await post('/annotations',{docId:doc.id,action:'upsert',annotation:{type:'bookmark',pdfPage:999}})
  expect(invalidAnnotation.status===400,'out-of-document annotation page rejected')
  const evidence=await getJson('/evidence?id='+doc.id+'&ref='+encodeURIComponent('[B0]'))
  expect(evidence.status===200 && evidence.body.evidence.pdfPage===1 && evidence.body.evidence.quote.includes('Hello'),'block evidence resolves real source')
  const pageEvidence=await getJson('/evidence?id='+doc.id+'&ref='+encodeURIComponent('[第 2 页]'))
  expect(pageEvidence.status===200 && pageEvidence.body.evidence.pdfPage===2,'physical page evidence resolves')
  const invalidEvidence=await getJson('/evidence?id='+doc.id+'&ref='+encodeURIComponent('[第 999 页]')+'&pages=999')
  expect(invalidEvidence.status===404,'client page count cannot authorize invalid evidence')

  const asked = await post('/ask', {
    docId: doc.id,
    question: 'What does this page say?',
    mode: 'learn',
    blockId: Math.min(1, fullDoc.blocks.length - 1),
  })
  expect(asked.status === 200, `ask failed: ${asked.text}`)
  const frames = asked.text.trim().split('\n').map(line => JSON.parse(line))
  const meta = frames.find(frame => frame.type === 'meta')
  expect(meta !== undefined && typeof meta.contextId === 'string', 'ask meta should carry a context id')
  expect(frames.some(frame => frame.type === 'reasoning'), 'ask should stream reasoning frames')
  expect(frames.some(frame => frame.type === 'delta' && frame.text.includes('回答')), 'ask should stream answer text')
  expect(frames.some(frame => frame.type === 'done'), 'ask should finish')

  if (meta !== undefined) {
    const detail = await getJson(`/context?id=${encodeURIComponent(doc.id)}&entry=${encodeURIComponent(meta.contextId)}`)
    expect(detail.status === 200, `context failed: ${JSON.stringify(detail.body)}`)
    const entry = detail.body?.entry
    expect(entry !== undefined, 'context should return an entry')
    expect(entry.prompt.includes('What does this page say?'), 'recorded prompt should contain the question')
    expect(entry.reasoning.includes('先确认'), 'recorded reasoning should be present')
    expect(Array.isArray(entry.images) && entry.images.length > 0, 'recorded entry should include page images')
    expect(entry.stats.estimatedTokens > 0, 'recorded entry should estimate tokens')

    if (entry.images.length > 0) {
      const image = await fetch(`${base}/context-image?id=${encodeURIComponent(doc.id)}&entry=${encodeURIComponent(meta.contextId)}&i=0`)
      expect(image.status === 200, `context image failed: ${image.status}`)
      expect((image.headers.get('content-type') ?? '').startsWith('image/'), 'context image should be an image')
      expect((await image.arrayBuffer()).byteLength > 0, 'context image should not be empty')

      const thumbnail = await fetch(`${base}/context-image?id=${encodeURIComponent(doc.id)}&entry=${encodeURIComponent(meta.contextId)}&i=0&w=420`)
      expect(thumbnail.status === 200, `context thumbnail failed: ${thumbnail.status}`)
      expect(Number(thumbnail.headers.get('x-page-width')) <= 420, 'context thumbnail should honor the w parameter')
      await thumbnail.arrayBuffer()
    }
  }

  const adaptive = await post('/ask', { docId: doc.id, question: 'ADAPTIVE_TEST', mode: 'learn', currentPage: 1, blockId: fullDoc.blocks.length - 1 })
  const adaptiveFrames = adaptive.text.trim().split('\n').map(line => JSON.parse(line))
  expect(adaptiveFrames.filter(frame => frame.type === 'resetText').length === 2, 'tool preambles should be reset')
  expect(adaptiveFrames.filter(frame => frame.type === 'reading').length === 2, 'both search and read should be visible')
  const adaptiveMeta = adaptiveFrames.find(frame => frame.type === 'meta')
  const adaptiveDetail = await getJson(`/context?id=${doc.id}&entry=${adaptiveMeta.contextId}`)
  const adaptiveEntry = adaptiveDetail.body.entry
  expect(adaptiveEntry.calls.length === 3, 'context should retain all three native turns')
  expect(adaptiveEntry.calls[0].messages.length === 1, 'early audit must not grow with continuation messages')
  expect(adaptiveEntry.usage.inputTokens === 140, 'usage should include both reading calls and final answer')
  expect(fullDoc.blocks[adaptiveEntry.notes.anchor].page === 0, 'learning anchor should clamp to actual visible page')
  expect(adaptiveEntry.reading.length === 2, 'context should retain reading trace')

  const translated = await post('/translate', {
    docId: doc.id,
    selection: 'Hello world from page one.',
    blockId: 1,
    targetLanguage: 'zh-CN',
  })
  expect(translated.status === 200, `translate failed: ${translated.text}`)
  const translateFrames = translated.text.trim().split('\n').map(line => JSON.parse(line))
  const translateMeta = translateFrames.find(frame => frame.type === 'meta')
  expect(translateMeta !== undefined && typeof translateMeta.contextId === 'string', 'translate meta should carry a context id')
  expect(translateFrames.some(frame => frame.type === 'reasoning'), 'translate should stream reasoning frames')
  expect(translateFrames.some(frame => frame.type === 'done'), 'translate should finish')

  routedCalls.length = 0
  modalityCalls.length = 0
  const chosen = { provider: 'selected', model: 'selected-model' }
  const selectedAsk = await post('/ask', { docId: doc.id, question: 'ADAPTIVE_TEST', currentPage: 1, blockId: 0, modelSelection: chosen })
  expect(selectedAsk.status === 200 && selectedAsk.text.includes('selected-model'), 'selected model is reported by ask')
  expect(routedCalls.length === 3 && routedCalls.every(call => call.provider === chosen.provider && call.model === chosen.model), 'selected model routes every tool continuation')
  expect(modalityCalls.some(call => call.provider === chosen.provider && call.model === chosen.model), 'vision checks selected model rather than default')
  routedCalls.length = 0
  const selectedTranslation = await post('/translate', { docId: doc.id, selection: 'Hello', blockId: 0, modelSelection: chosen })
  expect(selectedTranslation.status === 200 && routedCalls.length === 1 && routedCalls[0].model === chosen.model, 'translation routes selected model')
  for (const endpoint of ['/ask', '/translate']) {
    const invalid = await post(endpoint, { docId: doc.id, question: 'Hello', selection: 'Hello', modelSelection: { provider: 'selected', model: 'missing' } })
    expect(invalid.status === 400, 'unknown configured model rejects before generation')
  }
  expect((await getJson('/bootstrap')).body.model.model === 'fake-model', 'request selection never changes global default')

  expect(host.app.config.maxAnswerTokens === 16384, 'default answer budget supports long reasoning answers')
  const originalStream = llm.stream
  for (const endpoint of ['/ask', '/translate']) {
    for (const outcome of ['max-tokens', 'eof', 'error', 'aborted']) {
      let requests = 0
      llm.stream = () => {
        requests += 1
        return (async function* () {
          yield { type: 'text-delta', text: 'partial [第' }
          if (outcome === 'eof') return
          if (outcome === 'error') throw Object.assign(new Error('connection lost'), {code:'ECONNRESET'})
          yield { type: 'usage', usage: { outputTokens: 4096 } }
          yield { type: 'finish', reason: { kind: outcome } }
        })()
      }
      const response = await post(endpoint, {docId:doc.id,question:'stream terminal test',selection:'Hello',blockId:0,currentPage:1})
      const frames = response.text.trim().split('\n').map(line=>JSON.parse(line))
      const terminal = frames.at(-1)
      expect(frames.filter(frame=>frame.type==='delta').map(frame=>frame.text).join('') === 'partial [第', endpoint+' preserves even the buffered short first line on '+outcome)
      expect(!frames.some(frame=>frame.type==='done'), endpoint+' must not report truncated '+outcome+' as done')
      const code = {'max-tokens':'MAX_TOKENS',eof:'STREAM_INCOMPLETE',error:'ECONNRESET',aborted:'ABORTED'}[outcome]
      expect(terminal.type === (outcome === 'aborted' ? 'aborted' : 'error'), endpoint+' reports distinct terminal type '+outcome)
      if (outcome !== 'aborted') expect(terminal.code === code && terminal.partial === true, endpoint+' carries coded partial failure '+outcome)
      const meta=frames.find(frame=>frame.type==='meta')
      const details=await getJson('/context?id='+doc.id+'&entry='+meta.contextId)
      expect(details.body.entry.status === (outcome === 'aborted'?'aborted':'error'), endpoint+' audit should not say done after '+outcome)
      if (outcome === 'max-tokens' && endpoint === '/ask') expect(details.body.entry.calls.at(-1).finishReason==='max-tokens', 'request audit retains exact finish reason')
      if (outcome === 'max-tokens') expect(terminal.usage?.outputTokens === 4096, endpoint+' terminal retains output-token usage')
      expect(requests===1, endpoint+' should not silently retry partial '+outcome)
    }
  }
  llm.stream = () => asyncChunks([{type:'text-delta',text:'partial overview'},{type:'finish',reason:{kind:'max-tokens'}}])
  const partialOverview=await post('/ask',{docId:doc.id,question:'overview',overview:true})
  const overviewFailureFrames=partialOverview.text.trim().split('\n').map(line=>JSON.parse(line))
  expect(overviewFailureFrames.some(frame=>frame.type==='delta' && frame.text==='partial overview'), 'overview retains partial batch on truncation')
  expect(overviewFailureFrames.at(-1).code==='MAX_TOKENS' && !overviewFailureFrames.some(frame=>frame.type==='done'), 'overview truncation is explicitly non-normal')
  llm.stream=originalStream

  const missing = await getJson(`/context?id=${encodeURIComponent(doc.id)}&entry=missing`)
  expect(missing.status === 404, 'unknown context should return 404')

  const overview = await post('/ask', {
    docId: doc.id,
    question: 'Please summarize the book.',
    overview: true,
  })
  expect(overview.status === 200, `overview failed: ${overview.text}`)
  const overviewFrames = overview.text.trim().split('\n').map(line => JSON.parse(line))
  const overviewMeta = overviewFrames.find(frame => frame.type === 'meta')
  expect(overviewMeta !== undefined && typeof overviewMeta.contextId === 'string', 'overview meta should carry a context id')
  if (overviewMeta !== undefined && typeof overviewMeta.contextId === 'string') {
    const detail = await getJson(`/context?id=${encodeURIComponent(doc.id)}&entry=${encodeURIComponent(overviewMeta.contextId)}`)
    const entry = detail.body?.entry
    expect(entry !== undefined, 'overview context should return an entry')
    expect(entry.mode === 'overview', 'overview context mode should be overview')
    expect(entry.prompt.includes('# 章节资料'), 'overview context should contain the batch prompt')
    expect(entry.notes.overviewBatchCount === 1, 'overview should record the batch count')
    expect(Array.isArray(entry.images) && entry.images.length === 2, 'overview should attach both chapter pages')
  }
  let denied = false
  try { await annotationTool.execute({ action: 'list', documentPath: 'C:\\tmp\\denied.pdf' }) } catch (error) { denied = error.message.includes('Access denied') }
  expect(denied, 'annotation tool propagates filesystem authorization denial')
  const officeOpened = await post('/open', { path: 'sample.doc' })
  expect(officeOpened.status === 200, 'legacy Office fixture opens through conversion')
  if (officeOpened.status === 200) {
    const officeDoc = JSON.parse(officeOpened.text).doc
    host.app.entryDoc(officeDoc.id).doc.pages = [] // Logical extraction is not the physical preview count.
    const officePosition = await post('/reading-position', { docId: officeDoc.id, position: { pageNumber: 2, x: .1, y: .4 } })
    expect(officePosition.status === 200 && JSON.parse(officePosition.text).position.pageNumber === 2, 'Office position uses converted physical page count')
    const image = await fetch(base+'/page?id='+officeDoc.id+'&n=1&w=400')
    expect(image.status===200 && image.headers.get('content-type')==='image/jpeg', 'Office preview image uses converted PDF')
    await image.arrayBuffer()
    const evidence = await getJson('/evidence?id='+officeDoc.id+'&ref='+encodeURIComponent('[第 1 页]'))
    expect(evidence.status===200 && evidence.body.evidence.pdfPage===1, 'converted Office citation uses actual physical page')
  }
  const retiredEntry = host.app.entryDoc(doc.id)
  expect(retiredEntry.pdfium !== undefined, 'rendered document holds a PDFium handle before eviction')
  const oldMax = host.app.docs.max
  host.app.docs.max = 1
  await post('/open', { path: 'eviction.pdf' })
  expect(retiredEntry.retired===true && retiredEntry.pdfium===undefined, 'eviction releases PDFium document')
  host.app.docs.max = oldMax
} finally {
  server.close()
  host.dispose()
  if (!basename(annotationDirectory).startsWith('dsh-study-http-')) throw new Error('Unexpected test storage path')
  await rm(annotationDirectory, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error('smoke failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('ok: host routes, reasoning frames, context record and context image work')
