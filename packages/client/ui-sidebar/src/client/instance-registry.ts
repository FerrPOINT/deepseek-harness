const STORAGE_KEY = 'dsh.client.instances.v1'
const TRANSFER_KEY = 'dsh-switcher'
const MAX_INSTANCES = 32
const MAX_TRANSFER_BYTES = 65_536

export type InstanceInputError = 'required' | 'invalid' | 'credentials' | 'path' | 'query' | 'insecure'

export interface DshInstance {
  name: string
  url: string
}

export type InstanceInputResult =
  | { instance: DshInstance; launchUrl: string | null }
  | { error: InstanceInputError }

export interface InitialInstanceRegistry {
  instances: DshInstance[]
  hasTransfer: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function baseUrl(value: string): { url: string } | { error: InstanceInputError } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { error: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid' }
  if (url.username !== '' || url.password !== '') return { error: 'credentials' }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return { error: 'path' }
  if (!isLoopback(url.hostname) && url.protocol !== 'https:') return { error: 'insecure' }
  return { url: url.origin }
}

/** Validate a DSH base address or its one-time root login URL.
 * @param value Address or one-time login URL entered by the user.
 * @returns The normalized instance and optional login URL, or a localized error key.
 */
export function parseInstanceInput(value: string): InstanceInputResult {
  const trimmed = value.trim()
  if (trimmed === '') return { error: 'required' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { error: 'invalid' }
  }

  if (url.search === '') {
    const normalized = baseUrl(trimmed)
    return 'url' in normalized
      ? { instance: { name: '', url: normalized.url }, launchUrl: null }
      : normalized
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid' }
  if (url.username !== '' || url.password !== '') return { error: 'credentials' }
  if (url.hash !== '' || url.pathname !== '/') return { error: 'path' }
  const query = [...url.searchParams.entries()]
  if (query.length !== 1 || query[0]?.[0] !== 'token' || query[0][1] === '') return { error: 'query' }

  const normalized = baseUrl(url.origin)
  if (!('url' in normalized)) return normalized
  return { instance: { name: '', url: normalized.url }, launchUrl: url.href }
}

function parseStoredInstances(value: unknown): DshInstance[] {
  if (!Array.isArray(value)) return []
  const instances: DshInstance[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.url !== 'string') continue
    const name = entry.name.trim()
    if (name === '' || name.length > 48) continue
    const normalized = baseUrl(entry.url)
    if (!('url' in normalized) || seen.has(normalized.url)) continue
    seen.add(normalized.url)
    instances.push({ name, url: normalized.url })
    if (instances.length === MAX_INSTANCES) break
  }
  return instances
}

function decodeTransfer(encoded: string | null): DshInstance[] {
  if (encoded === null || encoded.length > MAX_TRANSFER_BYTES * 2) return []
  try {
    const base64 = decodeURIComponent(encoded).replace(/-/gu, '+').replace(/_/gu, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    if (binary.length > MAX_TRANSFER_BYTES) return []
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return parseStoredInstances(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return []
  }
}

function mergeInstances(...groups: (readonly DshInstance[])[]): DshInstance[] {
  const merged = new Map<string, DshInstance>()
  for (const group of groups) {
    for (const instance of group) merged.set(instance.url, instance)
  }
  return [...merged.values()].slice(-MAX_INSTANCES)
}

/** Read saved instances, import a carried roster, and ensure the current DSH appears.
 * @param href Current page URL.
 * @param storage Browser storage for this origin, when available.
 * @param localName Localized name for an unregistered loopback instance.
 * @returns The merged instance list and whether a transfer fragment was present.
 */
export function readInitialInstanceRegistry(
  href: string,
  storage: Pick<Storage, 'getItem'> | null,
  localName: string,
): InitialInstanceRegistry {
  let stored: DshInstance[] = []
  try {
    const serialized = storage?.getItem(STORAGE_KEY) ?? null
    if (serialized !== null) stored = parseStoredInstances(JSON.parse(serialized))
  } catch {
    stored = []
  }

  const currentUrl = new URL(href).origin
  const fragment = new URLSearchParams(new URL(href).hash.slice(1))
  const transferValue = fragment.get(TRANSFER_KEY)
  const carried = decodeTransfer(transferValue)
  const instances = mergeInstances(stored, carried)
  if (!instances.some(instance => instance.url === currentUrl)) {
    const current = new URL(currentUrl)
    instances.push({
      name: isLoopback(current.hostname) ? localName : current.host,
      url: currentUrl,
    })
  }
  return { instances: instances.slice(-MAX_INSTANCES), hasTransfer: transferValue !== null }
}

/** Persist the browser-local instance roster.
 * @param storage Browser storage for this origin, when available.
 * @param instances Validated instances to persist.
 * @returns Whether persistence completed without a storage error.
 */
export function writeInstanceRegistry(storage: Pick<Storage, 'setItem'> | null, instances: readonly DshInstance[]): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(instances))
    return true
  } catch {
    return false
  }
}

/** Carry the validated roster in a URL fragment while navigating to another DSH origin.
 * @param urlValue Destination DSH origin or one-time login URL.
 * @param instances Validated instances to make available at the destination.
 * @returns Destination URL with the encoded registry fragment.
 */
export function withInstanceRegistry(urlValue: string, instances: readonly DshInstance[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(instances))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')
  const url = new URL(urlValue)
  url.hash = `${TRANSFER_KEY}=${encoded}`
  return url.href
}

/** Remove the one-time roster fragment after the client imports it.
 * @param history Current browser history object.
 * @param href Current page URL.
 */
export function clearTransferredRegistry(history: Pick<History, 'replaceState' | 'state'>, href: string): void {
  const url = new URL(href)
  if (!new URLSearchParams(url.hash.slice(1)).has(TRANSFER_KEY)) return
  url.hash = ''
  history.replaceState(history.state, '', `${url.pathname}${url.search}`)
}
