import { GoogleGenerativeAI } from '@google/generative-ai'
import type { CallParams, CallResult, ModelAdapter, StreamEvent, Usage } from '../types'
import { normalizeProviderError, ProviderError } from '../errors'
import { assertTools, emptyUsage, resolveApiKey } from '../resolve'
import {
  fromGeminiParts,
  mapGeminiFinishReason,
  toGeminiContents,
  toGeminiTools
} from './convert'

/** Short Hebrew message for 400 / invalid_request — never dump raw JSON to the UI */
const GEMINI_INVALID_REQUEST_HE =
  'בקשה לא תקינה לספק Gemini. נסה שוב או החלף מודל.'

function toUserFacingGeminiError(err: unknown): ProviderError {
  const normalized = normalizeProviderError(err, 'gemini')
  const is400 =
    normalized.status === 400 || /\[?400\b|bad request/i.test(normalized.message)
  if (!is400) return normalized
  return new ProviderError({
    code: 'invalid_request',
    message: GEMINI_INVALID_REQUEST_HE,
    provider: 'gemini',
    status: normalized.status ?? 400,
    retryable: false,
    cause: normalized.cause ?? err
  })
}

function usageFromGemini(meta?: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  cachedContentTokenCount?: number
}): Usage {
  const inputTokens = meta?.promptTokenCount ?? 0
  const outputTokens = meta?.candidatesTokenCount ?? 0
  // Gemini 2.5+ ממטמן משתמע לפי קידומת יציבה — כמו OpenAI, דיווח בלבד
  const cacheReadTokens = meta?.cachedContentTokenCount ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: meta?.totalTokenCount ?? inputTokens + outputTokens,
    ...(cacheReadTokens ? { cacheReadTokens } : {})
  }
}

export const geminiAdapter: ModelAdapter = {
  id: 'gemini',

  async call(params: CallParams): Promise<CallResult> {
    return geminiAdapter.stream(params, () => undefined)
  },

  async stream(params: CallParams, onEvent: (event: StreamEvent) => void): Promise<CallResult> {
    try {
      const apiKey = resolveApiKey('gemini', params.apiKey)
      const tools = assertTools(params.tools)
      const genAI = new GoogleGenerativeAI(apiKey)

      const model = genAI.getGenerativeModel({
        model: params.model,
        systemInstruction: params.system?.trim() || undefined,
        // Schema objects are JSON-schema shaped; SDK types are stricter than runtime needs
        ...(tools.length ? { tools: toGeminiTools(tools) as never } : {})
      })

      const contents = toGeminiContents(params.messages)
      // Gemini requires at least one user turn
      if (!contents.length) {
        contents.push({ role: 'user', parts: [{ text: '' }] })
      }

      const result = await model.generateContentStream(
        {
          contents: contents as never,
          generationConfig: {
            maxOutputTokens: params.maxTokens ?? 8192,
            temperature: params.temperature
          }
        },
        // העברת signal ל-SDK — ביטול אמיתי של הבקשה, לא רק בין chunks
        params.signal ? { signal: params.signal } : undefined
      )

      let text = ''
      let finishReason: string | undefined
      let usage = emptyUsage()
      const functionParts: Array<{
        text?: string
        functionCall?: { name?: string; args?: Record<string, unknown> }
        thoughtSignature?: string
      }> = []

      for await (const chunk of result.stream) {
        if (params.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }

        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) finishReason = String(candidate.finishReason)

        const parts = candidate?.content?.parts || []
        for (const part of parts) {
          if ('text' in part && part.text) {
            text += part.text
            onEvent({ type: 'text', delta: part.text })
          }
          if ('functionCall' in part && part.functionCall) {
            functionParts.push({
              functionCall: {
                name: part.functionCall.name,
                args: part.functionCall.args as Record<string, unknown> | undefined
              },
              // Gemini 3 — חובה לשמר ולהחזיר בהיסטוריה
              thoughtSignature: (part as { thoughtSignature?: string }).thoughtSignature
            })
          }
        }
      }

      const aggregated = await result.response
      const meta = aggregated.usageMetadata
      if (meta) {
        usage = usageFromGemini(meta)
        onEvent({ type: 'usage', usage })
      }

      // Prefer final response parts for complete function calls
      const finalParts = aggregated.candidates?.[0]?.content?.parts || []
      // ה-SDK מוחק thoughtSignature באגרגציה (מעתיק רק text/functionCall) —
      // לכן ממזגים את החתימות שנלכדו מה-stream לפי סדר קריאות הפונקציה
      const streamedSignatures = functionParts.map((fp) => fp.thoughtSignature)
      let fcOrdinal = 0
      const assembled = fromGeminiParts(
        finalParts.length
          ? finalParts.map((p) => {
              const isFc = 'functionCall' in p && p.functionCall
              const sig = isFc
                ? ((p as { thoughtSignature?: string }).thoughtSignature ??
                  streamedSignatures[fcOrdinal++])
                : undefined
              return {
                text: 'text' in p ? p.text : undefined,
                functionCall: isFc
                  ? {
                      name: p.functionCall!.name,
                      args: p.functionCall!.args as Record<string, unknown> | undefined
                    }
                  : undefined,
                thoughtSignature: sig
              }
            })
          : [{ text }, ...functionParts]
      )

      // If we already streamed text, keep streamed text when final is empty
      if (!assembled.text && text) assembled.text = text

      for (const tc of assembled.toolCalls) {
        onEvent({ type: 'tool_call', toolCall: tc })
      }

      const callResult: CallResult = {
        text: assembled.text,
        toolCalls: assembled.toolCalls,
        stopReason: mapGeminiFinishReason(finishReason, assembled.toolCalls.length > 0),
        usage
      }
      onEvent({ type: 'done', result: callResult })
      return callResult
    } catch (err) {
      const normalized = toUserFacingGeminiError(err)
      onEvent({ type: 'error', error: normalized })
      throw normalized
    }
  }
}
