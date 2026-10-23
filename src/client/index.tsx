/** Browser half: OpenAI Codex account management inside dsh Settings. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { OpenAICodexSettings } from './OpenAICodexSettings.tsx'
import type { OpenAICodexSettingsInjected } from './OpenAICodexSettings.tsx'
import { ImagegenToolView } from './ImagegenToolView.tsx'
import { OpenAICodexFastModeToggle } from './OpenAICodexFastModeToggle.tsx'
import type { OpenAICodexFastModeToggleInjected } from './OpenAICodexFastModeToggle.tsx'
import { OpenAICodexQuotaIndicator } from './OpenAICodexQuotaIndicator.tsx'
import type { OpenAICodexQuotaIndicatorInjected } from './OpenAICodexQuotaIndicator.tsx'
import { en, zh } from './locales.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** OpenAI Codex account page copy. */
    'settings.openai-codex': OpenAICodexSettingsKey
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-codex-client'
/** Client services required by the settings contribution. */
export const inject = ['slots', 'locale']

/** Register account copy and the OpenAI Codex settings page. */
export function apply(ctx: ClientContext): void {
  const namespace = 'settings.openai-codex'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-openai-codex: settings copy')
  const t = ctx.locale.bind(namespace) as OpenAICodexSettingsInjected['t']
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'openai-codex',
    order: 15,
    label: () => t('nav'),
    locale: namespace,
  }, OpenAICodexSettings))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'imagegen',
    locale: namespace,
  }, ImagegenToolView))
  ctx.inject(['slots', 'modelDirectories'], scope => {
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'openai-codex-fast-mode',
      order: 10,
      locale: namespace,
      inject: (sessionId: string): OpenAICodexFastModeToggleInjected => ({
        sessionId,
        directory: scope.modelDirectories.directoryFor(sessionId as SessionId).store,
      }),
    }, OpenAICodexFastModeToggle))
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'openai-codex-quota',
      order: 20,
      locale: namespace,
      inject: (sessionId: string): OpenAICodexQuotaIndicatorInjected => ({
        directory: scope.modelDirectories.directoryFor(sessionId as SessionId).store,
      }),
    }, OpenAICodexQuotaIndicator))
  })
}
