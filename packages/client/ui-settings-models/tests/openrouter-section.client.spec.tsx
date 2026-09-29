// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { LlmProviderUsage } from '@deepseek-ai/dsh-api-remotes/client'
import { OpenRouterSection } from '../src/client/OpenRouterSection.tsx'
import { openRouterEn } from '../src/client/openrouter-locales.ts'

afterEach(cleanup)

const usage: LlmProviderUsage = {
  provider: 'openrouter', currency: 'USD', totalUsage: 201.4594, dailyUsage: 0.1036,
  weeklyUsage: 0.1036, monthlyUsage: 100.2175, limit: 200, limitRemaining: 199.8964,
  limitReset: 'weekly', freeTier: false, observedAt: '2026-09-28T00:00:00.000Z',
}

type OpenRouterTranslate = ComponentProps<typeof OpenRouterSection>['t']

function isOpenRouterKey(key: string): key is keyof typeof openRouterEn {
  return Object.hasOwn(openRouterEn, key)
}

const t: OpenRouterTranslate = key => isOpenRouterKey(key) ? openRouterEn[key] : key

describe('OpenRouterSection', () => {
  it('loads the snapshot and exposes provider account destinations', async () => {
    render(<OpenRouterSection t={t} loadUsage={() => Promise.resolve(usage)} />)
    await screen.findByText('Used this week')
    expect(screen.getByText('This month')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Activity/ }).getAttribute('href')).toBe('https://openrouter.ai/activity')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('100')
  })

  it('keeps the last successful snapshot when a refresh fails', async () => {
    const load = vi.fn().mockResolvedValueOnce(usage).mockRejectedValueOnce(new Error('offline'))
    render(<OpenRouterSection t={t} loadUsage={load} />)
    await screen.findByText('All time')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => { expect(screen.getByText(openRouterEn.refreshFailed)).toBeTruthy() })
    expect(screen.getByText('All time')).toBeTruthy()
  })

  it('offers retry after the initial read fails', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(usage)
    render(<OpenRouterSection t={t} loadUsage={load} />)
    await screen.findByText(openRouterEn.loadFailed)
    fireEvent.click(screen.getByRole('button', { name: openRouterEn.retry }))
    await screen.findByText('All time')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
