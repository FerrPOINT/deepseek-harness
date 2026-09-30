/** Portable first-run settings shipped with the Web profile. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

const rows = composeEntries([
  loadOverlayPatches('web-base-defaults', fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))),
  loadOverlayPatches('web-profile-defaults', fileURLToPath(new URL('../../../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))),
])

function config(id: string): Record<string, unknown> {
  return rows.find(row => row.id === id)?.config as Record<string, unknown>
}

it('ships the current OpenRouter model, locale, and permission defaults without credentials', () => {
  expect(config('agent-default-model')).toMatchObject({
    provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', reasoningEffort: 'high',
  })
  const llm = config('llm-pi-ai')
  expect(llm).toMatchObject({
    providers: {
      openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        models: [{ id: 'deepseek/deepseek-v4.1-flash', contextWindow: 262144, maxTokens: 65536 }],
      },
    },
  })
  expect((llm['providers'] as Record<string, Record<string, unknown>>).openrouter).not.toHaveProperty('apiKey')
  expect(config('locale')).toMatchObject({ preference: 'ru-pro' })
  expect(config('ui-theme')).toMatchObject({ preference: 'dark', fontSize: 14 })
  expect(config('permission')).toMatchObject({ defaultPreset: 'danger-full-access' })
})

it('ships coding providers and their runtime dependencies with the Web profile', () => {
  expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([
    'subagent-codex', 'lsp', 'lsp-stdio', 'tool-lsp',
  ]))
  expect(config('subagent-codex')).toMatchObject({
    permissionMode: 'dangerously-bypass-approvals-and-sandbox',
  })
  expect(config('lsp-stdio')).toHaveProperty('servers.typescript')

  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(
    '../../../../../packages/bundle/web-app/package.json', import.meta.url,
  )), 'utf8')) as { dependencies: Record<string, string> }
  expect(manifest.dependencies).toMatchObject({
    '@deepseek-ai/dsh-lsp': 'workspace:*',
    '@deepseek-ai/dsh-lsp-stdio': 'workspace:*',
    '@deepseek-ai/dsh-subagent-codex': 'workspace:*',
    '@deepseek-ai/dsh-tool-lsp': 'workspace:*',
    'typescript': '6.0.3',
    'typescript-language-server': '5.3.0',
  })
})
