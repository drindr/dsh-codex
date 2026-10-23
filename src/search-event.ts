/** Durable request records owned by the OpenAI Codex search provider. */

import type { Context } from '@deepseek-ai/cordis'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type { OpenAICodexSearchRequestRecord } from './search.ts'

/** Informational, non-surface record written before a search dispatch. */
export const OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT = 'plugin:dsh-codex/search-llm-request'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Exact secret-free OpenAI Codex standalone-search request. */
    'plugin:dsh-codex/search-llm-request': OpenAICodexSearchRequestRecord
  }
}

/** Kept for callers of older releases; plugin records need no global registration. */
export function installOpenAICodexSearchEvent(): void {}

/**
 * Append an ignorable plugin record to the initiating agent's session. The
 * public plugin-record seam snapshots the JSON and keeps it outside the
 * model-visible surface, without changing the released core event vocabulary.
 * Searches outside an agent turn have no owning session and produce no log.
 */
export function recordOpenAICodexSearchRequest(
  ctx: Context,
  request: OpenAICodexSearchRequestRecord,
): void {
  const session = ctx.get('agents')?.currentInitiator()?.session
  if (session !== undefined) appendPluginRecord(session, OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT, request)
}
