import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function definition(name) {
  const match=source.match(new RegExp(`^    async function ${name}\\([^]*?^    \\}`, 'm'))
  assert.ok(match, `actual ${name} function exists`)
  return '('+match[0]+')'
}
function transport(chunks) {
  const frames=[], encoder=new TextEncoder()
  const stream=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(typeof chunk==='string'?encoder.encode(chunk):chunk);controller.close()}})
  let options
  const fn=vm.runInNewContext(definition('streamPost'),{
    TextDecoder,
    apiPost:async(path,payload,next)=>{options=next;return new Response(stream)},
  })
  return {frames,stream,run:signal=>fn('/ask',{},signal,frame=>frames.push(frame)),options:()=>options}
}

test('complete split UTF-8 stream preserves Markdown and LaTeX exactly and accepts final unterminated line',async()=>{
  const text='**中文**\\n\\[\\nabla_\\theta J = A \\, \\nabla p\\]'
  const bytes=new TextEncoder().encode(JSON.stringify({type:'delta',text})+'\n'+JSON.stringify({type:'done'}))
  const chunks=Array.from(bytes,byte=>new Uint8Array([byte]))
  const run=transport(chunks)
  const controller=new AbortController()
  await run.run(controller.signal)
  assert.equal(run.frames[0].text,text)
  assert.equal(run.frames.at(-1).type,'done')
  assert.equal(run.options().signal,controller.signal)
  assert.equal(run.stream.locked,false)
})

test('EOF after partial answer is an incomplete stream rather than successful completion',async()=>{
  const run=transport([JSON.stringify({type:'delta',text:'原书 [第'})+'\n'])
  await assert.rejects(run.run(new AbortController().signal),{code:'STREAM_INCOMPLETE'})
  assert.equal(run.frames[0].text,'原书 [第')
  assert.equal(run.stream.locked,false)
})

test('broken final frame reports invalid stream while retaining earlier complete deltas',async()=>{
  const run=transport(['{"type":"delta","text":"partial"}\n{"type":"do'])
  await assert.rejects(run.run(),{code:'STREAM_INVALID'})
  assert.equal(run.frames[0].text,'partial')
  assert.equal(run.stream.locked,false)
})

test('explicit error and abort are valid terminal frames and never require done',async()=>{
  for(const type of ['error','aborted']){
    const run=transport([JSON.stringify({type,message:'stopped',code:'MAX_TOKENS',finishReason:'max-tokens'})+'\n'])
    await run.run()
    assert.equal(run.frames[0].type,type)
  }
})

test('a locally aborted signal is passed through and not reported as normal completion',async()=>{
  const run=transport(['{"type":"done"}\n'])
  const controller=new AbortController();controller.abort()
  await assert.rejects(run.run(controller.signal),{name:'AbortError'})
  assert.equal(run.frames.length,0)
  assert.equal(run.options().signal,controller.signal)
  assert.equal(run.stream.locked,false)
})

test('data after the terminal marker is rejected rather than silently changing completed content',async()=>{
  const run=transport(['{"type":"done"}\n{"type":"delta","text":"late"}\n'])
  await assert.rejects(run.run(),{code:'STREAM_INVALID'})
  assert.equal(run.frames.length,1)
})

test('copy message source copies only exact raw Markdown/LaTeX without rendered text or reasoning',async()=>{
  let copied
  const fn=vm.runInNewContext(definition('copyMessageSource'),{copyText:async text=>{copied=text;return true}})
  const text='  **原文**\n\n\\[\n\\nabla_\\theta J = A\\,\\nabla p\n\\]\n\n`$code$`\n\tend  '
  const message={text,reasoning:'must not be copied',quote:'must not be prepended',pages:[95]}
  assert.equal(await fn(message),true)
  assert.equal(copied,text)
})

test('copy failure is returned to the message action rather than falsely reporting success',async()=>{
  const fn=vm.runInNewContext(definition('copyMessageSource'),{copyText:async()=>false})
  assert.equal(await fn({text:'body'}),false)
})
