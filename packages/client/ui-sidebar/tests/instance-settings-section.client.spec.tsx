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

function mount(instances = [{ name: 'Current DSH', url: 'https://current.example.com' }], writeInstances = vi.fn(() => true)) {
  const setInstances = vi.fn()
  const openInstance = vi.fn()
  const props = {
    close: vi.fn(),
    useStore: <T,>(select: (state: { instances: typeof instances }) => T) => select({ instances }),
    actions: { setInstances },
    writeInstances,
    openInstance,
    t,
    useResource,
  } as unknown as InstanceSettingsSectionProps
  render(<InstanceSettingsSection {...props} />)
  return { setInstances, writeInstances, openInstance }
}

describe('DSH instance settings', () => {
  it('saves a root address and returns to the instance list', () => {
    const { setInstances, writeInstances, openInstance } = mount()

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
    expect(openInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a one-time sign-in URL without saving its token', () => {
    const { setInstances, openInstance } = mount()
    const signInUrl = 'https://dev.example.com/?token=one-time-secret'

    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.name']), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: signInUrl } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))

    expect(setInstances).toHaveBeenCalledWith([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev.example.com' },
    ])
    expect(openInstance).toHaveBeenCalledWith(signInUrl)
  })

  it('opens a selected saved origin directly', () => {
    const { openInstance } = mount()

    fireEvent.click(screen.getByRole('button', { name: /https:\/\/current\.example\.com/ }))

    expect(openInstance).toHaveBeenCalledWith('https://current.example.com')
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

  it('does not navigate when selecting the current origin', () => {
    const { openInstance } = mount([{ name: 'Here', url: window.location.origin }])
    fireEvent.click(screen.getByRole('button', { name: /http:\/\/localhost:3000/ }))
    expect(openInstance).not.toHaveBeenCalled()
  })

  it.each([
    ['', 'instance.error.required'],
    ['not an address', 'instance.error.invalid'],
    ['https://user:secret@dev.example.com', 'instance.error.credentials'],
    ['https://dev.example.com/path', 'instance.error.path'],
    ['https://dev.example.com/?key=x', 'instance.error.query'],
    ['http://dev.example.com', 'instance.error.insecure'],
  ])('shows validation error for %j', (address, message) => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: address } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(screen.getByRole('alert').textContent).toBe(en[message as keyof typeof en])
  })

  it('rejects a duplicate origin and clears validation when the input changes', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://current.example.com/' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(screen.getByRole('alert').textContent).toBe(en['instance.error.duplicate'])
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://different.example.com' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('defaults an empty remote name to its host and allows cancelling the form', () => {
    const { setInstances } = mount()
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://dev.example.com/' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(setInstances).toHaveBeenCalledWith([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'dev.example.com', url: 'https://dev.example.com' },
    ])

    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.click(screen.getAllByRole('button', { name: en['instance.cancel'] })[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses the localized default name for a local server and closes from the dialog control', () => {
    const { setInstances } = mount()
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'http://localhost:3080/' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(setInstances).toHaveBeenCalledWith([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: en['instance.local'], url: 'http://localhost:3080' },
    ])

    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.click(screen.getAllByRole('button', { name: en['instance.cancel'] })[1]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rejects names over 48 characters and does not persist them', () => {
    const { writeInstances } = mount()
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.name']), { target: { value: 'x'.repeat(49) } })
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://dev.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(screen.getByRole('alert').textContent).toBe(en['instance.error.name'])
    expect(writeInstances).not.toHaveBeenCalled()
  })

  it('rejects adding a 33rd instance', () => {
    const instances = Array.from({ length: 32 }, (_, index) => ({
      name: `Server ${index}`,
      url: `https://server-${index}.example.com`,
    }))
    const { writeInstances } = mount(instances)
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://extra.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(screen.getByRole('alert').textContent).toBe(en['instance.error.limit'])
    expect(writeInstances).not.toHaveBeenCalled()
  })

  it('reports storage failure without updating the shared roster', () => {
    const writeInstances = vi.fn(() => false)
    const { setInstances } = mount(undefined, writeInstances)
    fireEvent.click(screen.getByRole('button', { name: en['instance.add'] }))
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://dev.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.add.submit'] }))
    expect(screen.getByRole('alert').textContent).toBe(en['instance.error.storage'])
    expect(setInstances).not.toHaveBeenCalled()
  })

  it('edits a saved instance and keeps its old name when the name is blank', () => {
    const { setInstances } = mount([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev.example.com' },
    ])
    fireEvent.click(screen.getByRole('button', { name: `${en['instance.edit']}: Dev` }))
    expect(screen.getByLabelText<HTMLInputElement>(en['instance.url']).value).toBe('https://dev.example.com')
    fireEvent.change(screen.getByLabelText(en['instance.url']), { target: { value: 'https://dev2.example.com' } })
    fireEvent.change(screen.getByLabelText(en['instance.name']), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: en['instance.save'] }))
    expect(setInstances).toHaveBeenCalledWith([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev2.example.com' },
    ])
  })

  it('does not allow editing the current server address', () => {
    mount([{ name: 'Current DSH', url: window.location.origin }])
    fireEvent.click(screen.getByRole('button', { name: `${en['instance.edit']}: Current DSH` }))
    expect(screen.getByLabelText(en['instance.url']).hasAttribute('disabled')).toBe(true)
  })

  it('deletes another instance and supports cancelling deletion', () => {
    const { setInstances } = mount([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev.example.com' },
    ])
    fireEvent.click(screen.getByRole('button', { name: `${en['instance.delete']}: Dev` }))
    fireEvent.click(screen.getByRole('button', { name: en['instance.cancel'] }))
    expect(setInstances).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: `${en['instance.delete']}: Dev` }))
    fireEvent.click(screen.getByRole('button', { name: en['instance.delete.confirm'] }))
    expect(setInstances).toHaveBeenCalledWith([{ name: 'Current DSH', url: 'https://current.example.com' }])
  })

  it('moves away from the current server after deleting it', () => {
    const { openInstance } = mount([
      { name: 'Current DSH', url: window.location.origin },
      { name: 'Dev', url: 'https://dev.example.com' },
    ])
    fireEvent.click(screen.getByRole('button', { name: `${en['instance.delete']}: Current DSH` }))
    fireEvent.click(screen.getByRole('button', { name: en['instance.delete.confirm'] }))
    expect(openInstance).toHaveBeenCalledWith('https://dev.example.com')
  })

  it('keeps the roster intact and shows an error when deletion cannot persist', () => {
    const writeInstances = vi.fn(() => false)
    const { setInstances } = mount([
      { name: 'Current DSH', url: 'https://current.example.com' },
      { name: 'Dev', url: 'https://dev.example.com' },
    ], writeInstances)
    fireEvent.click(screen.getByRole('button', { name: `${en['instance.delete']}: Dev` }))
    fireEvent.click(screen.getByRole('button', { name: en['instance.delete.confirm'] }))
    expect(screen.getByRole('alert').textContent).toBe(en['instance.error.storage'])
    expect(setInstances).not.toHaveBeenCalled()
  })

  it('disables deleting the only remaining instance', () => {
    mount()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: `${en['instance.delete']}: Current DSH` }).disabled).toBe(true)
  })

  it('shows the checking state while a status request is pending', async () => {
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    mount()
    const check = screen.getByRole('button', { name: `${en['instance.status.check']}: Current DSH` }) as HTMLButtonElement
    fireEvent.click(check)
    expect(check.disabled).toBe(true)
    expect(screen.getByText(en['instance.status.checking'])).toBeTruthy()
    resolveFetch(new Response(null, { status: 204 }))
  })
})
