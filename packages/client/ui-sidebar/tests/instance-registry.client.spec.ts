import { describe, expect, it, vi } from 'vitest'
import {
  clearLegacyInstanceTransfer, parseInstanceInput, readInitialInstanceRegistry, writeInstanceRegistry,
} from '../src/client/instance-registry.ts'

describe('DSH instance input', () => {
  it.each([
    ['', 'required'],
    ['  ', 'required'],
    ['invalid', 'invalid'],
    ['ftp://dsh.example.com', 'invalid'],
    ['https://user:secret@dsh.example.com', 'credentials'],
    ['https://dsh.example.com/path', 'path'],
    ['http://dsh.example.com', 'insecure'],
    ['http://[::1]:3080/', undefined],
    ['http://localhost:3080/', undefined],
    ['https://dsh.example.com/', undefined],
  ] as const)('normalizes base address %j', (input, error) => {
    const result = parseInstanceInput(input)
    if (error !== undefined) expect(result).toEqual({ error })
    else {
      const expectedUrl = input.includes('localhost') ? 'http://localhost:3080'
        : input.includes('[::1]') ? 'http://[::1]:3080' : 'https://dsh.example.com'
      expect(result).toEqual({ instance: { name: '', url: expectedUrl }, launchUrl: null })
    }
  })

  it.each([
    ['ftp://dsh.example.com/?token=t', 'invalid'],
    ['https://user:secret@dsh.example.com/?token=t', 'credentials'],
    ['https://dsh.example.com/path?token=t', 'path'],
    ['https://dsh.example.com/?token=t#extra', 'path'],
    ['https://dsh.example.com/?key=t', 'query'],
    ['https://dsh.example.com/?token=', 'query'],
    ['https://dsh.example.com/?token=t&extra=x', 'query'],
    ['http://dsh.example.com/?token=t', 'insecure'],
  ] as const)('rejects invalid one-time URL %j', (input, error) => {
    expect(parseInstanceInput(input)).toEqual({ error })
  })

  it('keeps a valid one-time URL for navigation and stores only its origin', () => {
    const result = parseInstanceInput(' https://dsh.example.com:8443/?token=one-time-secret ')
    expect(result).toEqual({
      instance: { name: '', url: 'https://dsh.example.com:8443' },
      launchUrl: 'https://dsh.example.com:8443/?token=one-time-secret',
    })
  })
})

describe('DSH instance registry persistence', () => {
  it('loads and normalizes saved rows, skips invalid entries and keeps unique origins', () => {
    const stored = [
      null,
      { name: 12, url: 'https://wrong-name.example.com' },
      { name: 'missing url' },
      { name: '   ', url: 'https://blank-name.example.com' },
      { name: 'n'.repeat(49), url: 'https://long-name.example.com' },
      { name: 'insecure', url: 'http://remote.example.com' },
      { name: 'Invalid', url: 'not a url' },
      { name: '  First  ', url: 'https://saved.example.com/' },
      { name: 'Duplicate', url: 'https://saved.example.com:443' },
    ]
    const storage = { getItem: vi.fn(() => JSON.stringify(stored)) }
    expect(readInitialInstanceRegistry('https://current.example.com/path', storage, 'Local DSH')).toEqual({
      instances: [
        { name: 'First', url: 'https://saved.example.com' },
        { name: 'current.example.com', url: 'https://current.example.com' },
      ],
    })
  })

  it('uses the localized local name when the current origin is not registered', () => {
    expect(readInitialInstanceRegistry('http://localhost:3080/', null, 'Local DSH')).toEqual({
      instances: [{ name: 'Local DSH', url: 'http://localhost:3080' }],
    })
  })

  it('stops importing saved rows at the instance limit', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      name: `Server ${index}`,
      url: `https://server-${index}.example.com`,
    }))
    const result = readInitialInstanceRegistry('https://current.example.com/', { getItem: () => JSON.stringify(rows) }, 'Local')
    expect(result.instances).toHaveLength(32)
    expect(result.instances[0]?.name).toBe('Server 1')
  })

  it('falls back to the current origin when storage access or JSON parsing fails', () => {
    const throwingStorage = { getItem: () => { throw new Error('storage denied') } }
    expect(readInitialInstanceRegistry('https://current.example.com/', throwingStorage, 'Local')).toMatchObject({
      instances: [{ name: 'current.example.com', url: 'https://current.example.com' }],
    })
    expect(readInitialInstanceRegistry('https://current.example.com/', { getItem: () => '{' }, 'Local').instances)
      .toEqual([{ name: 'current.example.com', url: 'https://current.example.com' }])
    expect(readInitialInstanceRegistry('https://current.example.com/', { getItem: () => '{"instances":[]}' }, 'Local').instances)
      .toEqual([{ name: 'current.example.com', url: 'https://current.example.com' }])
  })

  it('does not import a roster from an obsolete switcher fragment', () => {
    const result = readInitialInstanceRegistry(
      'https://current.example.com/#dsh-switcher=eyJuYW1lIjoiRXh0ZXJuYWwiLCJ1cmwiOiJodHRwczovL2V4YW1wbGUuY29tIn0',
      null,
      'Local',
    )
    expect(result).toEqual({ instances: [{ name: 'current.example.com', url: 'https://current.example.com' }] })
  })

  it('writes browser storage and reports storage failures', () => {
    const instances = [{ name: 'DSH', url: 'https://dsh.example.com' }]
    const setItem = vi.fn()
    expect(writeInstanceRegistry({ setItem }, instances)).toBe(true)
    expect(setItem).toHaveBeenCalledWith('dsh.client.instances.v1', JSON.stringify(instances))
    expect(writeInstanceRegistry(null, instances)).toBe(true)
    expect(writeInstanceRegistry({ setItem: () => { throw new Error('storage full') } }, instances)).toBe(false)
  })

  it('clears an obsolete switcher fragment without importing it', () => {
    const history = { state: { key: 'state' }, replaceState: vi.fn() }
    clearLegacyInstanceTransfer(history, 'https://dsh.example.com/?token=t#dsh-switcher=old-data&tab=settings')
    expect(history.replaceState).toHaveBeenCalledWith(history.state, '', '/?token=t#tab=settings')
  })

  it('leaves an ordinary fragment unchanged when no legacy registry is present', () => {
    const history = { state: null, replaceState: vi.fn() }
    clearLegacyInstanceTransfer(history, 'https://dsh.example.com/?token=t#anchor')
    expect(history.replaceState).not.toHaveBeenCalled()
  })
})
