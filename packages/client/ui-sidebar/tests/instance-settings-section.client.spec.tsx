// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { InstanceSettingsSection } from '../src/client/InstanceSettingsSection.tsx'
import type { InstanceSettingsSectionProps } from '../src/client/InstanceSettingsSection.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en) as InstanceSettingsSectionProps['t']
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount() {
  const instances = [{ name: 'Current DSH', url: 'https://current.example.com' }]
  const setInstances = vi.fn()
  const writeInstances = vi.fn(() => true)
  const props = {
    close: vi.fn(),
    useStore: <T,>(select: (state: { instances: typeof instances }) => T) => select({ instances }),
    actions: { setInstances },
    writeInstances,
    t,
    useResource,
  } as unknown as InstanceSettingsSectionProps
  render(<InstanceSettingsSection {...props} />)
  return { setInstances, writeInstances }
}

describe('DSH instance settings', () => {
  it('saves a root address and returns to the instance list', () => {
    const { setInstances, writeInstances } = mount()

    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.name']), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://dev.example.com/' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))

    expect(writeInstances).toHaveBeenCalledWith([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev.example.com' },
    ])
    expect(setInstances).toHaveBeenCalledWith([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev.example.com' },
    ])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('checks an instance without sending cookies or authentication', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    mount()

    fireEvent.click(screen.getByRole('button', { name: `${en['instance.status.check']}: Current DSH` }))

    expect(await screen.findByText(en['instance.status.available'])).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('https://current.example.com', expect.objectContaining({
      method: 'HEAD',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
    }))
  })

  it('keeps an unreachable status distinct from a successful HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network unavailable') }))
    mount()

    fireEvent.click(screen.getByRole('button', { name: `${en['instance.status.check']}: Current DSH` }))

    expect(await screen.findByText(en['instance.status.unavailable'])).toBeTruthy()
  })
})
