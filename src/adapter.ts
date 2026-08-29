/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */

import { createModels, defaultProviderAuthContext } from '@earendil-works/pi-ai'
import type { MutableModels, Provider } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { OpenAICodexCredentialStore } from './store.ts'
import { OPENAI_CODEX_PROVIDER } from './store.ts'
import { OPENAI_CODEX_SOL_1M_MODEL, OPENAI_CODEX_SOL_1M_WIRE_MODEL, OpenAICodexResponseRuntime } from './responses.ts'
import type { ResponseApiPreferences } from './tool-policy.ts'

/** Provider idle ceiling used by the composite route. */
export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000

/**
 * The official GPT-5.6 Sol specification documents a 1,050,000-token context
 * window, while the Codex subscription catalog bundled with pi-ai caps every
 * model at 272K. OpenAI accepts subscription-route requests beyond the catalog
 * value, so the route offers both: the catalog entry stays the default, and a
 * local `gpt-5.6-sol-1m` variant exposes the full window. The alias never
 * leaves this process — the transport rewrites it on the wire (responses.ts).
 */
function withCodexContextVariants(provider: Provider<'openai-codex-responses'>): Provider<'openai-codex-responses'> {
  const base = provider.getModels.bind(provider)
  return {
    ...provider,
    getModels: () => base().flatMap(model =>
      model.id === OPENAI_CODEX_SOL_1M_WIRE_MODEL
        ? [model, { ...model, id: OPENAI_CODEX_SOL_1M_MODEL, name: `${model.name} (1M)`, contextWindow: 1_050_000 }]
        : [model],
    ),
  }
}

/**
 * Give the generic dsh adapter a request-scoped bearer-token entry without
 * changing the provider's user-facing OAuth flow. The resolver accepts only
 * the explicit override supplied by this plugin; it never discovers an API
 * key from the environment or persistent api-key credentials.
 */
function requestProvider(provider: Provider): Provider {
  return {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        name: 'OpenAI Codex OAuth bearer token',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'OAuth' }
        },
      },
    },
  }
}

/** Preserve Harness call purpose until the generic pi-ai adapter reaches the provider. */
class OpenAICodexAdapter extends PiAiAdapter {
  constructor(
    options: ConstructorParameters<typeof PiAiAdapter>[0],
    private readonly responses: OpenAICodexResponseRuntime,
  ) {
    super(options)
  }

  /**
   * The seam dispatches through the prepared call, and the base implementation
   * binds it to a private snapshot path that bypasses `stream()` — the purpose
   * marker must wrap both entry points or a compaction request would reach the
   * provider unmarked.
   */
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const call = await super.prepareCall(provider, model, signal)
    return {
      model: call.model,
      stream: options => this.withPurpose(call.stream(options), options),
    }
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.withPurpose(super.stream(options), options)
  }

  private async *withPurpose(inner: AsyncIterable<StreamChunk>, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const release = options.purpose === 'compaction'
      ? this.responses.enterCompaction(options.sessionId === undefined ? undefined : String(options.sessionId))
      : undefined
    try {
      for await (const chunk of inner) yield chunk
    } finally {
      release?.()
    }
  }
}

/**
 * Create the Codex subscription adapter without requiring a dsh fork. The
 * public pi-ai adapter owns Harness message conversion, image attachment
 * resolution, streaming, and reasoning metadata. This plugin adds optional
 * Codex-native request state/compaction and supplies the provider OAuth token.
 */
export function createOpenAICodexAdapter(
  credentials: OpenAICodexCredentialStore,
  resolveAttachments: () => AttachmentStore | undefined,
  responsePreferences: () => ResponseApiPreferences,
): PiAiAdapter {
  const provider = withCodexContextVariants(openaiCodexProvider())
  const responses = new OpenAICodexResponseRuntime(responsePreferences)
  const profiles = new Map<string, ResolvedPiAiProviderProfile>([[OPENAI_CODEX_PROVIDER, {
    provider: OPENAI_CODEX_PROVIDER,
    displayName: 'OpenAI Codex',
    streamIdleTimeoutMs: OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-openai-codex retryPolicy'),
    configuredMaxTokens: new Map(),
    piProvider: responses.wrap(requestProvider(provider)),
  }]])
  const models: MutableModels = createModels({ credentials })
  models.setProvider(provider)
  return new OpenAICodexAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => (await models.getAuth(OPENAI_CODEX_PROVIDER))?.auth.apiKey,
    auth: { credentials, authContext: defaultProviderAuthContext() },
    resolveAttachments,
  }, responses)
}
