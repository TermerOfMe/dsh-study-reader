import assert from 'node:assert/strict'
import { test } from 'node:test'
import { streamCompletion } from '../lib/llm.js'

const context = stream => ({ get: name => name === 'llm' ? { stream } : name === 'agentDefaultModel' ? { currentSelection: () => ({provider:'test',model:'test'}) } : undefined })
async function run(chunks, options = {}) {
  const deltas = [], audits = []
  const ctx = context(async function* () { for (const chunk of chunks) { if (chunk instanceof Error) throw chunk; yield chunk } })
  const request = streamCompletion({ ctx, prompt: 'test', retryOnEmpty: false, onDelta: value => deltas.push(value), onCall: value => audits.push(value), ...options })
  return { request, deltas, audits }
}

test('normal stop and tool-call finish are accepted and audited without retries', async () => {
  for (const kind of ['stop','tool-calls']) {
    const chunks = kind === 'stop' ? [{type:'text-delta',text:'complete'}] : [{type:'block-end',index:0,block:{type:'tool-call',id:'call1',name:'document_read',arguments:'{}'}}]
    const { request, audits } = await run([...chunks,{type:'finish',reason:{kind}}])
    const result = await request
    assert.equal(result.failureKind,kind)
    assert.equal(result.calls.length,kind === 'stop' ? 0 : 1)
    assert.equal(audits[0].finishReason,kind)
    assert.equal(audits[0].status,'done')
    assert.equal(audits.length,1)
  }
})

test('partial token-limit preserves output and reports exact non-normal finish instead of success', async () => {
  const {request,deltas,audits} = await run([{type:'text-delta',text:'partial [第'},{type:'usage',usage:{outputTokens:4096}},{type:'finish',reason:{kind:'max-tokens'}}])
  await assert.rejects(request,error => error.code === 'MAX_TOKENS' && error.finishReason === 'max-tokens' && error.partialText === 'partial [第' && error.usage.outputTokens === 4096)
  assert.equal(deltas.join(''),'partial [第')
  assert.equal(audits[0].status,'error')
  assert.equal(audits[0].finishReason,'max-tokens')
  assert.equal(audits.length,1)
})

test('token-limited partial tool calls never reach tool execution as valid calls', async () => {
  const {request} = await run([{type:'tool-call-delta',index:0,id:'call1',name:'document_read',argumentsDelta:'{"pages":['},{type:'finish',reason:{kind:'max-tokens'}}])
  await assert.rejects(request,{code:'MAX_TOKENS'})
})

test('premature EOF with partial output is a specific failure; no partial output is discarded', async () => {
  const {request,deltas,audits} = await run([{type:'reasoning-delta',text:'thinking'},{type:'text-delta',text:'partial'}])
  await assert.rejects(request,error => error.code === 'STREAM_INCOMPLETE' && error.partialText === 'partial' && error.partialReasoning === 'thinking' && error.finishReason === 'missing-finish')
  assert.equal(deltas.join(''),'partial')
  assert.equal(audits[0].status,'error')
})

test('provider error finish preserves provider failure code and partial output', async () => {
  const {request} = await run([{type:'text-delta',text:'partial'},{type:'finish',reason:{kind:'error',failure:{code:'RATE_LIMIT',message:'rate limit'}}}])
  await assert.rejects(request,error => error.code === 'RATE_LIMIT' && error.partialText === 'partial' && error.finishReason === 'error')
})

test('thrown transport errors retain their stable code and partial content', async () => {
  const {request} = await run([{type:'text-delta',text:'partial'},Object.assign(new Error('socket closed'),{code:'ECONNRESET'})])
  await assert.rejects(request,error => error.code === 'ECONNRESET' && error.partialText === 'partial' && error.partial === true)
})

test('adapter cancellation and caller cancellation remain distinct from transport failures', async () => {
  const terminal = await run([{type:'text-delta',text:'partial'},{type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message:'cancelled'}}}])
  await assert.rejects(terminal.request,error => error.aborted === true && error.code === 'ABORTED' && error.partialText === 'partial')
  const controller = new AbortController()
  const deltas=[]
  const ctx=context(async function*(){yield {type:'text-delta',text:'partial'};controller.abort();})
  await assert.rejects(streamCompletion({ctx,prompt:'test',signal:controller.signal,onDelta:text=>deltas.push(text)}),error=>error.aborted===true && error.code==='ABORTED')
  assert.equal(deltas.join(''),'partial')
})

test('content after finish is rejected instead of silently appended', async () => {
  const {request,deltas} = await run([{type:'text-delta',text:'complete'},{type:'finish',reason:{kind:'stop'}},{type:'text-delta',text:'invalid'}])
  await assert.rejects(request,{code:'STREAM_PROTOCOL_ERROR'})
  assert.equal(deltas.join(''),'complete')
})
