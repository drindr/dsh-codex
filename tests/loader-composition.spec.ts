import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { type Entry } from '@deepseek-ai/cordis-plugin-loader'
import SettingsForms from '@deepseek-ai/dsh-settings'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as OpenAICodex from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function isolateCredentials(directory: string): Promise<void> {
  vi.stubEnv('DSH_HOME', directory)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network access is forbidden in composition tests') }))
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const access = `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } })}.fixture`
  const credentials = new OpenAICodex.OpenAICodexCredentialStore()
  await credentials.modify(OpenAICodex.OPENAI_CODEX_PROVIDER, async () => ({
    type: 'oauth', access, refresh: 'fixture-refresh', expires: Date.now() + 3_600_000, accountId: 'fixture-account',
  }))
}

describe('OpenAI Codex real composition', () => {
  it('loads through the Loader, exposes the catalog, and unregisters on disposal', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-openai-codex-loader-'))
    await isolateCredentials(root)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: llm',
      "  name: 'test-llm-service'",
      '- id: web',
      "  name: 'test-web-service'",
      '- id: llm-openai-codex',
      '  name: dsh-codex',
      '  config:',
      '    contextWindow: 512000',
      '    models:',
      '      - gpt-5.6-luna',
      '      - gpt-5.6-terra',
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-llm-service', LlmRuntime],
      ['test-web-service', WebRuntime],
      ['dsh-codex', OpenAICodex],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    expect(ctx.llm.listProviders()).toEqual([{ id: 'openai-codex', name: 'OpenAI Codex' }])
    const models = await ctx.llm.listModels('openai-codex')
    expect(models.map(model => model.id)).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra'])
    await expect(ctx.llm.resolveModelInfo('openai-codex', 'gpt-5.6-luna')).resolves.toMatchObject({
      context: { contextWindow: 512_000 },
    })

    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'dsh-codex')
    if (entry === undefined) throw new Error('OpenAI Codex Loader entry missing')
    if (entry.fiber === undefined) throw new Error('OpenAI Codex plugin fiber missing')
    await entry.fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('persists SettingsForms edits through Loader volatile references without remounting', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-openai-codex-live-settings-'))
    await isolateCredentials(root)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: llm',
      '  name: test-llm-service',
      '- id: web',
      '  name: test-web-service',
      '- id: settings',
      '  name: test-settings-service',
      '- id: custom-codex',
      '  name: dsh-codex',
      '  config:',
      '    models: [gpt-5.6-luna]',
      '',
    ].join('\n'))
    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    // Test profile editor: durable writes still use the real Loader Entry,
    // while SettingsForms owns field filtering, validation, and form policy.
    const entries = () => [...ctx.loader.entries()].filter(entry => entry.options.name === 'dsh-codex')
    ctx.provide('profileContext', { home: root, name: 'test' } as never)
    ctx.provide('configEditor', {
      documentPath: configPath,
      entries,
      configuration: () => entries().map(entry => ({ entry, inherited: {}, override: entry.options.config ?? {} })),
      async edit(entry: Entry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) {
        await entry.update({ config: change(entry.options.config ?? {}, {}) })
        entry.parent.tree.write()
      },
    } as never)
    const modules = new Map<string, unknown>([
      ['test-llm-service', LlmRuntime],
      ['test-web-service', WebRuntime],
      ['test-settings-service', SettingsForms],
      ['dsh-codex', OpenAICodex],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const entry = entries()[0]
    if (entry?.fiber === undefined) throw new Error('OpenAI Codex plugin fiber missing')
    const fiber = entry.fiber
    const service = ctx.openAICodex
    expect(ctx.settings.describe().find(row => String(row.ns) === 'custom-codex')?.autoGenerate).toBe(false)
    let modelsAtNotification: string[] | undefined
    ctx.on('llm/adapters-updated', () => {
      modelsAtNotification = service.modelCatalogSettings().models
    })

    await ctx.settings.update('custom-codex', {
      models: ['gpt-6.1-sol'],
      contextWindow: 512_000,
      modifyReadImage: false,
      useStatefulResponses: true,
    })
    expect(entry.fiber).toBe(fiber)
    expect(ctx.openAICodex).toBe(service)
    expect(modelsAtNotification).toEqual(['gpt-6.1-sol'])
    expect((await ctx.llm.listModels('openai-codex')).map(model => model.id)).toEqual(['gpt-6.1-sol'])
    await expect(ctx.llm.resolveModelInfo('openai-codex', 'gpt-6.1-sol')).resolves.toMatchObject({ context: { contextWindow: 512_000 } })
    expect(service.imagePreferences().modifyReadImage).toBe(false)
    expect(service.responsePreferences().useWebSocketContextReuse).toBe(true)
    await expect.poll(() => readFile(configPath, 'utf8')).toContain('gpt-6.1-sol')

    await service.updateResponsePreferences({ useWebSocketContextReuse: false })
    expect(service.responsePreferences().useWebSocketContextReuse).toBe(false)
    await ctx.settings.replace('custom-codex', {})
    expect(service.modelCatalogSettings().models).toContain('gpt-6-sol')
    expect(service.modelCatalogSettings().models).toContain('gpt-6.1-sol')
    expect(service.contextWindowPreferences().contextWindow).toBeNull()
    expect(entry.fiber).toBe(fiber)
  })

})
