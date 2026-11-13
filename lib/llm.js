/** Default-model calls for the reader; no Session events are created. */
import { randomUUID } from 'node:crypto'

export class LlmUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'LlmUnavailableError' }
}

export function resolveModel(ctx) {
  const service = ctx.get('agentDefaultModel')
  if (service === undefined) throw new LlmUnavailableError('当前 DSH 没有配置默认模型服务。')
  const selection = service.currentSelection()
  if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new LlmUnavailableError('当前 DSH 还没有可用的默认模型，请先在模型设置中选择一个模型。')
  }
  return { provider: selection.provider, model: selection.model }
}

export function addUsage(total, usage) {
  if (!usage || typeof usage !== 'object') return total
  const result = { ...total }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (Number.isFinite(usage[key])) result[key] = (result[key] || 0) + usage[key]
  }
  return result
}

/** One turn, optionally with tools. Callers own execution and continuation. */
export async function streamCompletion({ ctx, system, prompt, maxTokens, temperature, signal, onDelta, onReasoning,
  images, retryOnEmpty = true, retryMaxTokens = 16384, messages, tools, modelSelection, onCall, onUsage }) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new LlmUnavailableError('当前 DSH 没有挂载 LLM 服务。')
  const { provider, model } = modelSelection ?? resolveModel(ctx)
  const content = [{ type: 'text', text: prompt ?? '' }]
  for (const image of images ?? []) if (image) content.push({ type: 'image', attachment: image })
  const requestMessages = messages ?? [{ role: 'user', content }]
  const baseBudget = Math.max(64, Math.floor(maxTokens || 1600))
  let accumulatedUsage
  const run = async (budget, systemText) => {
    let text = '', reasoning = '', usage, failure = '', failureKind = '', replayState, terminalFailure, finished = false
    const blocks = new Map(), partialCalls = new Map()
    const started = Date.now()
    const audit = { system: systemText, messages: structuredClone(requestMessages), tools: structuredClone(tools ?? []), maxTokens: budget, status: 'streaming' }
    onCall?.(audit)
    try {
      for await (const chunk of llm.stream({ provider, model, system: systemText, messages: requestMessages,
        ...(tools?.length ? { tools } : {}), maxTokens: budget,
        temperature: typeof temperature === 'number' ? temperature : 0.3, signal })) {
        if (!chunk || typeof chunk !== 'object') continue
        if (signal?.aborted) throw Object.assign(new Error('已停止生成。'), { aborted: true })
        if (finished) throw Object.assign(new Error('模型流在结束标记之后仍返回内容。'), { code: 'STREAM_PROTOCOL_ERROR' })
        if (chunk.type === 'text-delta') {
          text += chunk.text; onDelta?.(chunk.text)
        } else if (chunk.type === 'reasoning-delta') {
          reasoning += chunk.text; onReasoning?.(chunk.text)
        } else if (chunk.type === 'tool-call-delta') {
          const call = partialCalls.get(chunk.index) ?? { type: 'tool-call', id: chunk.id, name: '', arguments: '' }
          call.id = chunk.id ?? call.id
          if (chunk.name) call.name = chunk.name
          call.arguments += chunk.argumentsDelta ?? ''
          partialCalls.set(chunk.index, call)
        } else if (chunk.type === 'block-end') {
          blocks.set(chunk.index, chunk.block)
          if (chunk.block?.type === 'reasoning' && reasoning === '' && chunk.block.text) {
            reasoning = chunk.block.text; onReasoning?.(reasoning)
          }
          if (chunk.block?.type === 'text' && text === '' && chunk.block.text) {
            text = chunk.block.text; onDelta?.(text)
          }
        } else if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') {
          finished = true
          terminalFailure = chunk.reason?.failure
          replayState = chunk.replayState
          failureKind = chunk.reason?.kind ?? ''
          if (failureKind === 'error' || failureKind === 'aborted') failure = chunk.reason.failure?.message ?? '模型请求失败。'
          else if (failureKind === 'max-tokens') failure = '模型达到输出长度上限。'
        }
      }
      if (signal?.aborted || failureKind === 'aborted') throw Object.assign(new Error('已停止生成。'), { aborted: true })
      if (!finished) throw Object.assign(new LlmUnavailableError('模型连接在返回结束标记前中断，回答可能不完整。'), { code: 'STREAM_INCOMPLETE', finishReason: 'missing-finish' })
      audit.finishReason = failureKind
      if (failureKind === 'error') throw Object.assign(new LlmUnavailableError(failure), { code: terminalFailure?.code || 'MODEL_ERROR', finishReason: failureKind })
      if (!failureKind) throw Object.assign(new LlmUnavailableError('模型返回了无效的结束标记。'), { code: 'STREAM_PROTOCOL_ERROR', finishReason: 'invalid-finish' })
      const calls = [...new Map([...partialCalls, ...[...blocks].filter(([, b]) => b?.type === 'tool-call')]).values()]
      audit.status = failureKind === 'max-tokens' ? 'error' : 'done'
      if (failure) audit.error = failure
      return { text, reasoning, usage, failure, failureKind, calls, replayState, blocks: [...blocks.entries()].sort((a,b) => a[0]-b[0]).map(([,b]) => b) }
    } catch (error) {
      audit.status = signal?.aborted || error.aborted ? 'aborted' : 'error'
      audit.error = error instanceof Error ? error.message : String(error)
      audit.finishReason = error.finishReason || failureKind || (signal?.aborted || error.aborted ? 'aborted' : 'transport-error')
      const details = { partialText: text, partialReasoning: reasoning, partial: Boolean(text || reasoning), usage, finishReason: error.finishReason || failureKind || undefined }
      if (audit.status === 'aborted') throw Object.assign(new Error('已停止生成。'), details, { aborted: true, code: 'ABORTED', finishReason: 'aborted' })
      throw Object.assign(new LlmUnavailableError(`模型调用失败：${audit.error}`), details, { code: error.code || 'STREAM_ERROR' })
    } finally {
      audit.durationMs = Date.now() - started
      audit.usage = usage
      accumulatedUsage = addUsage(accumulatedUsage, usage)
      onUsage?.(usage)
    }
  }
  let result = await run(baseBudget, system)
  let allReasoning = result.reasoning
  if (retryOnEmpty && !result.calls.length && result.text.trim() === '' && result.failureKind === 'max-tokens' && baseBudget < retryMaxTokens) {
    result = await run(Math.min(retryMaxTokens, Math.max(4096, baseBudget * 2)), `${system}\n\n请压缩推理，优先给出答案。`)
    allReasoning += result.reasoning
  }
  if (result.failureKind === 'max-tokens') {
    throw Object.assign(new LlmUnavailableError('模型达到输出长度上限（思考过程与正文共用输出预算），回答可能不完整；已保留收到的内容。'), {
      code: 'MAX_TOKENS', finishReason: 'max-tokens', partial: Boolean(result.text || allReasoning),
      partialText: result.text, partialReasoning: allReasoning, usage: accumulatedUsage,
    })
  }
  if (!result.calls.length && result.text.trim() === '') {
    throw new LlmUnavailableError(result.failure || '模型没有返回内容，请稍后重试。')
  }
  const assistantContent = result.blocks.length ? result.blocks : [
    ...(result.reasoning ? [{ type: 'reasoning', text: result.reasoning }] : []),
    ...(result.text ? [{ type: 'text', text: result.text }] : []),
  ]
  // Completed blocks are authoritative; adapters may emit only deltas for calls.
  for (const call of result.calls) if (!assistantContent.some(b => b.type === 'tool-call' && b.id === call.id)) assistantContent.push(call)
  if (result.reasoning && !assistantContent.some(b => b.type === 'reasoning')) assistantContent.unshift({ type: 'reasoning', text: result.reasoning })
  if (result.text && !assistantContent.some(b => b.type === 'text')) assistantContent.unshift({ type: 'text', text: result.text })
  return { ...result, reasoning: allReasoning, provider, model, usage: accumulatedUsage,
    assistantMessage: { id: randomUUID(), role: 'assistant', source: { kind: 'model', provider, model,
      ...(result.replayState ? { replayState: result.replayState } : {}) }, content: assistantContent },
    finishWarning: result.failure || undefined }
}

/** Configured catalogue only; partial provider failures are returned explicitly. */
export async function listConfiguredModels(ctx) {
  const llm = ctx.get('llm')
  if (!llm) throw new LlmUnavailableError('当前 DSH 没有挂载 LLM 服务。')
  const providers = await llm.listProviders()
  const models = [], errors = []
  await Promise.all(providers.map(async provider => {
    try {
      for (const item of await llm.listModels(provider.id)) {
        if (typeof item.id !== 'string' || !item.id) continue
        models.push({ provider: provider.id, model: item.id, name: item.name || item.id, providerName: provider.name || provider.id })
      }
    } catch (error) { errors.push({ provider: provider.id, message: error instanceof Error ? error.message : String(error) }) }
  }))
  models.sort((a,b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
  return { models: models.filter((item, index) => !models.slice(0,index).some(other => other.provider === item.provider && other.model === item.model)), ...(errors.length ? { errors } : {}) }
}
export async function resolveRequestModel(ctx, selection) {
  if (selection == null) return resolveModel(ctx)
  if (typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).some(key => !['provider','model'].includes(key)) || !['provider','model'].every(key => typeof selection[key] === 'string' && selection[key].length > 0 && selection[key].length <= 500)) {
    throw Object.assign(new Error('无效的模型选择。'), { status: 400, code: 'bad-model-selection' })
  }
  const { models, errors } = await listConfiguredModels(ctx)
  if (!models.some(item => item.provider === selection.provider && item.model === selection.model)) {
    throw Object.assign(new Error(errors?.some(item => item.provider === selection.provider) ? '无法读取所选供应商的模型目录，请重试。' : '所选模型不在当前配置的模型目录中，请重新选择。'), { status: 400, code: 'bad-model-selection' })
  }
  return { provider: selection.provider, model: selection.model }
}
