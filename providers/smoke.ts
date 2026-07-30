/**
 * Live smoke: THE SAME CallParams against OpenAI + Anthropic + Gemini.
 *
 * Prerequisites — set API keys:
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
 *
 * Run:
 *   npx --yes tsx providers/smoke.ts
 */
import { call, stream, textMessage, type CallParams, type CallResult } from './index'

const SYSTEM = 'Reply with exactly one short sentence. No markdown.'

function baseParams(model: string, apiKey: string | undefined): CallParams {
  return {
    model,
    system: SYSTEM,
    messages: [textMessage('user', 'Say hello in Hebrew in under 8 words.')],
    tools: [],
    apiKey,
    maxTokens: 128
  }
}

async function runOne(label: string, params: CallParams): Promise<void> {
  console.log(`\n=== ${label} (${params.model}) ===`)
  if (!params.apiKey) {
    console.log('SKIP — missing apiKey / env')
    return
  }

  const chunks: string[] = []
  const streamed = await stream(params, (ev) => {
    if (ev.type === 'text') chunks.push(ev.delta)
  })
  printResult('stream', streamed, chunks.join(''))

  const once = await call(params)
  printResult('call', once)
}

function printResult(mode: string, result: CallResult, streamedText?: string): void {
  console.log(`[${mode}] stopReason=${result.stopReason}`)
  console.log(`[${mode}] text=${JSON.stringify(result.text)}`)
  console.log(`[${mode}] toolCalls=${result.toolCalls.length}`)
  console.log(
    `[${mode}] usage in=${result.usage.inputTokens} out=${result.usage.outputTokens} total=${result.usage.totalTokens}`
  )
  if (streamedText !== undefined) {
    console.log(`[${mode}] streamed_matches=${streamedText === result.text}`)
  }
}

async function main(): Promise<void> {
  // Identical request shape — only model (+ key) changes
  await runOne('OpenAI', baseParams('gpt-4.1', process.env.OPENAI_API_KEY))
  await runOne('Anthropic', baseParams('claude-haiku-4-5-20251001', process.env.ANTHROPIC_API_KEY))
  await runOne('Gemini', baseParams('gemini-2.5-flash', process.env.GEMINI_API_KEY))
  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
