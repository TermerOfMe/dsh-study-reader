/**
 * Thin wrapper over the Host `llm` service used by the Study Reader. The
 * reader is not a Session: answers and translations are ephemeral helper
 * output, so nothing here appends Session events or mutates agent state.
 */

export class LlmUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LlmUnavailableError'
  }
}

export function resolveModel(ctx) {
  const service = ctx.get('agentDefaultModel')
  if (service === undefined) {
    throw new LlmUnavailableError('当前 DSH 没有配置默认模型服务。')
  }
  const selection = service.currentSelection()
  if (selection === null || typeof selection !== 'object' || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new LlmUnavailableError('当前 DSH 还没有可用的默认模型，请先在模型设置中选择一个模型。')
  }
  return { provider: selection.provider, model: selection.model }
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Stream one text completion. Optional page images are attached as durable
 * ImageBlock references; reasoning-heavy models that exhaust the output budget
 * before emitting text are retried once with a larger budget.
 * @param {object} options
 * @param {import('@deepseek-ai/cordis').Context} options.ctx
 * @param {string} options.system
 * @param {string} options.prompt
 * @param {number} options.maxTokens
 * @param {number} options.temperature
 * @param {AbortSignal} [options.signal]
 * @param {(text: string) => void} [options.onDelta]
 * @param {(text: string) => void} [options.onReasoning]
 * @param {readonly object[]} [options.images] durable ImageAttachmentRefs
 * @returns {Promise<{ text: string, reasoning: string, provider: string, model: string, usage?: object }>}
 */
export async function streamCompletion({ ctx, system, prompt, maxTokens, temperature, signal, onDelta, onReasoning, images, retryOnEmpty = true }) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new LlmUnavailableError('当前 DSH 没有挂载 LLM 服务。')
  const { provider, model } = resolveModel(ctx)
  const content = [{ type: 'text', text: prompt }]
  for (const image of Array.isArray(images) ? images : []) {
    if (image !== null && image !== undefined) content.push({ type: 'image', attachment: image })
  }
  const baseBudget = Math.max(64, Math.floor(maxTokens || 1600))

  const run = async (budget, systemText) => {
    let text = ''
    let reasoning = ''
    let usage
    let failure = ''
    let failureKind = ''
    try {
      const stream = llm.stream({
        provider,
        model,
        system: systemText,
        messages: [{ role: 'user', content }],
        maxTokens: budget,
        temperature: typeof temperature === 'number' ? temperature : 0.3,
        signal,
      })
      for await (const chunk of stream) {
        if (chunk === null || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
          text += chunk.text
          if (onDelta !== undefined) onDelta(chunk.text)
        } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
          reasoning += chunk.text
          if (onReasoning !== undefined) onReasoning(chunk.text)
        } else if (chunk.type === 'block-end' && reasoning === '' && chunk.block?.type === 'reasoning' && typeof chunk.block.text === 'string' && chunk.block.text !== '') {
          // Some adapters send only the completed reasoning block. Keep it
          // rather than showing nothing.
          reasoning = chunk.block.text
          if (onReasoning !== undefined) onReasoning(reasoning)
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else if (chunk.type === 'finish') {
          const reason = chunk.reason
          failureKind = reason?.kind ?? ''
          if (reason?.kind === 'error') failure = reason.failure?.message ?? '模型请求失败。'
          else if (reason?.kind === 'aborted') failure = reason.failure?.message ?? '已停止生成。'
          else if (reason?.kind === 'max-tokens') failure = '模型在生成任何内容前用完了输出长度。'
        }
      }
    } catch (error) {
      if (signal?.aborted === true) throw Object.assign(new Error('已停止生成。'), { aborted: true })
      throw new LlmUnavailableError(`模型调用失败：${messageOf(error)}`)
    }
    return { text, reasoning, usage, failure, failureKind }
  }

  let result = await run(baseBudget, system)
  let allReasoning = result.reasoning
  if (retryOnEmpty && result.text.trim() === '' && result.failureKind === 'max-tokens' && baseBudget < 16_384) {
    const retryBudget = Math.min(16_384, Math.max(4_096, baseBudget * 2))
    const retrySystem = `${system}\n\n上一次回答在给出正文前用完了输出预算。请先直接给出答案，再补充必要解释；不要输出冗长的内部推理过程。`
    result = await run(retryBudget, retrySystem)
    allReasoning += result.reasoning
  }
  if (result.text.trim() === '' && result.failureKind === 'max-tokens') {
    throw new LlmUnavailableError('模型把输出预算都用在了推理上，没有生成正文。可以换一种更具体的问法，或在插件配置里调大 maxAnswerTokens。')
  }
  if (result.text.trim() === '' && result.failure !== '') throw new LlmUnavailableError(result.failure)
  if (result.text.trim() === '') throw new LlmUnavailableError('模型没有返回内容，请稍后重试。')
  return { text: result.text, reasoning: allReasoning, provider, model, usage: result.usage, finishWarning: result.failure || undefined }
}
