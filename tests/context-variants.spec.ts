import { describe, expect, it } from 'vitest'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { SimpleStreamOptions } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { createOpenAICodexAdapter } from '../src/adapter.ts'
import { OpenAICodexCredentialStore } from '../src/store.ts'
import {
  OPENAI_CODEX_SOL_1M_MODEL,
  OPENAI_CODEX_SOL_1M_WIRE_MODEL,
  OpenAICodexResponseRuntime,
  wireModelId,
} from '../src/responses.ts'

describe('Codex context window variants (local patch)', () => {
  it('lists the catalog default and the 1M variant side by side', async () => {
    const store = new OpenAICodexCredentialStore('/tmp/dsh-codex-variant-test-auth.json')
    const adapter = createOpenAICodexAdapter(store, () => undefined, () => ({
      useWebSocketContextReuse: false,
      useNativeCompaction: false,
    }))
    const models = await adapter.listModels('openai-codex')
    const ids = models.map(model => model.id)
    expect(ids).toContain(OPENAI_CODEX_SOL_1M_WIRE_MODEL)
    expect(ids).toContain(OPENAI_CODEX_SOL_1M_MODEL)
    const sol = await adapter.resolveModel('openai-codex', OPENAI_CODEX_SOL_1M_WIRE_MODEL)
    expect(sol.context?.contextWindow).toBe(272_000)
    const variant = await adapter.resolveModel('openai-codex', OPENAI_CODEX_SOL_1M_MODEL)
    expect(variant.context?.contextWindow).toBe(1_050_000)
    expect(variant.name).toContain('1M')
    expect(variant.inputModalities).toEqual(sol.inputModalities)
    expect(variant.reasoning?.efforts.length).toBeGreaterThan(0)
  })

  it('rewrites the variant alias to the backend model id on the wire', async () => {
    const base = openaiCodexProvider()
    let captured: SimpleStreamOptions | undefined
    const provider = {
      ...base,
      streamSimple: (_model: never, _context: never, options?: SimpleStreamOptions) => {
        captured = options
        return createAssistantMessageEventStream()
      },
    } satisfies typeof base
    const runtime = new OpenAICodexResponseRuntime(() => ({
      useWebSocketContextReuse: false,
      useNativeCompaction: false,
    }))
    const wrapped = runtime.wrap(provider)
    const catalogModel = base.getModels().find(candidate => candidate.id === OPENAI_CODEX_SOL_1M_WIRE_MODEL)
    if (catalogModel === undefined) throw new Error('Codex provider has no test model')
    const variant = { ...catalogModel, id: OPENAI_CODEX_SOL_1M_MODEL }
    wrapped.streamSimple(variant, { messages: [] }, {})
    const transformed = await captured?.onPayload?.(
      { model: variant.id, store: false, input: [] },
      variant,
    )
    expect(transformed).toEqual({ model: OPENAI_CODEX_SOL_1M_WIRE_MODEL, store: false, input: [] })
  })

  it('maps only the local alias, leaving catalog ids untouched', () => {
    expect(wireModelId(OPENAI_CODEX_SOL_1M_MODEL)).toBe(OPENAI_CODEX_SOL_1M_WIRE_MODEL)
    expect(wireModelId(OPENAI_CODEX_SOL_1M_WIRE_MODEL)).toBe(OPENAI_CODEX_SOL_1M_WIRE_MODEL)
    expect(wireModelId('gpt-5.5')).toBe('gpt-5.5')
  })
})
