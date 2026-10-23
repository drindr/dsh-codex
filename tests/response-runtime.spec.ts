import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssistantMessageEventStream, normalizeContext } from '@earendil-works/pi-ai'
import type { SimpleStreamOptions, Transport } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { OpenAICodexResponseRuntime } from '../src/responses.ts'

afterEach(() => { vi.unstubAllGlobals() })

function runtimeHarness(initialReuse: boolean) {
  let reuse = initialReuse
  const transports: Array<Transport | undefined> = []
  const streamOptions: SimpleStreamOptions[] = []
  const base = openaiCodexProvider()
  const provider = {
    ...base,
    streamSimple: (_model, _context, options?: SimpleStreamOptions) => {
      transports.push(options?.transport)
      if (options !== undefined) streamOptions.push(options)
      return createAssistantMessageEventStream()
    },
  } satisfies typeof base
  const runtime = new OpenAICodexResponseRuntime(() => ({
    useWebSocketContextReuse: reuse,
    useNativeCompaction: false,
  }))
  const wrapped = runtime.wrap(provider)
  const model = base.getModels().find(candidate => candidate.id === 'gpt-5.6-sol')
    ?? base.getModels()[0]
  if (model === undefined) throw new Error('Codex provider has no test model')
  const call = (sessionId: string): void => {
    wrapped.streamSimple(model, normalizeContext({ messages: [] }), { sessionId })
  }
  return {
    transports,
    streamOptions,
    runtime,
    model,
    call,
    setReuse(value: boolean): void { reuse = value },
  }
}

describe('OpenAICodexResponseRuntime transport policy', () => {
  it.each(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'])(
    'sends %s and its requested reasoning effort unchanged', async (id) => {
      const base = openaiCodexProvider()
      const model = base.getModels().find(candidate => candidate.id === id)
      if (model === undefined) throw new Error(`missing Codex model ${id}`)
      const runtime = new OpenAICodexResponseRuntime(() => ({
        useWebSocketContextReuse: false, useNativeCompaction: false,
      }))
      const fetch = vi.fn(() => { throw new Error('network must not be reached') })
      vi.stubGlobal('fetch', fetch)
      let payload: unknown
      const tokenBody = Buffer.from(JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' },
      })).toString('base64url')
      const stream = runtime.wrap(base).streamSimple(model, normalizeContext({
        systemPrompt: 'Check the model transport.',
        messages: [{ role: 'user', content: 'test', timestamp: 0 }],
      }), {
        apiKey: `test.${tokenBody}.signature`,
        reasoning: 'max',
        onPayload(body) {
          payload = body
          throw new Error('payload inspection complete')
        },
      })
      const result = await stream.result()
      expect(result.errorMessage).toContain('payload inspection complete')
      expect(fetch).not.toHaveBeenCalled()
      expect(payload).toMatchObject({ model: id, reasoning: { effort: 'max' } })
    },
  )

  it('uses explicit SSE while context reuse is disabled', () => {
    const harness = runtimeHarness(false)

    harness.call('session-sse')

    expect(harness.transports).toEqual(['sse'])
  })

  it('delegates matching continuation state to pi-ai WebSocket caching', () => {
    const harness = runtimeHarness(true)

    harness.call('session-websocket')

    expect(harness.transports).toEqual(['websocket-cached'])
  })

  it('preserves the provider-owned store:false payload', async () => {
    const harness = runtimeHarness(true)
    harness.call('session-store-false')

    const transformed = await harness.streamOptions[0]?.onPayload?.({ store: false, input: [] }, harness.model)

    expect(transformed).toEqual({ store: false, input: [], model: harness.model.id })
  })

  it('keeps Harness compaction calls off the conversation WebSocket chain', () => {
    const harness = runtimeHarness(true)
    const leaveCompaction = harness.runtime.enterCompaction('session-compact')

    harness.call('session-compact')
    leaveCompaction()
    harness.call('session-compact')

    expect(harness.transports).toEqual(['sse', 'websocket-cached'])
  })

  it('applies live preference changes without retaining plugin continuation state', () => {
    const harness = runtimeHarness(false)

    harness.call('session-live')
    harness.setReuse(true)
    harness.call('session-live')
    harness.setReuse(false)
    harness.call('session-live')

    expect(harness.transports).toEqual(['sse', 'websocket-cached', 'sse'])
  })
})
