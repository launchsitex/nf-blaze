/**
 * OpenAI-compatible providers: Ollama + LM Studio (local, no key) and OpenRouter.
 * Model ids carry the provider prefix, e.g. `ollama:qwen2.5-coder:14b`,
 * `lmstudio:qwen2.5-coder-14b-instruct`, `openrouter:deepseek/deepseek-chat`.
 */
import type { ModelAdapter } from './types'
import { createOpenAICompatAdapter } from './openai/adapter'

/** Ollama endpoint — overridable via OLLAMA_BASE_URL (default local daemon) */
export function ollamaBaseUrl(): string {
  const fromEnv = process.env.OLLAMA_BASE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return 'http://127.0.0.1:11434/v1'
}

/** LM Studio endpoint — overridable via LMSTUDIO_BASE_URL (default local server) */
export function lmstudioBaseUrl(): string {
  const fromEnv = process.env.LMSTUDIO_BASE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return 'http://127.0.0.1:1234/v1'
}

export const ollamaAdapter: ModelAdapter = createOpenAICompatAdapter({
  id: 'ollama',
  baseURL: ollamaBaseUrl
})

export const lmstudioAdapter: ModelAdapter = createOpenAICompatAdapter({
  id: 'lmstudio',
  baseURL: lmstudioBaseUrl
})

export const openrouterAdapter: ModelAdapter = createOpenAICompatAdapter({
  id: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://nf-blaze.local',
    'X-Title': 'NF-Blaze'
  }
})
