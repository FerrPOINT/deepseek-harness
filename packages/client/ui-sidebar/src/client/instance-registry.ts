const STORAGE_KEY = 'dsh.client.instances.v1'
const TRANSFER_KEY = 'dsh-switcher'
const MAX_INSTANCES = 32

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

/** Read this origin's saved instances and ensure the current DSH appears.
 * @param href Current page URL.
 * @param storage Browser storage for this origin, when available.
 * @param localName Localized name for an unregistered loopback instance.
 * @returns This origin's saved instance list.
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
  const instances = stored
  if (!instances.some(instance => instance.url === currentUrl)) {
    const current = new URL(currentUrl)
    instances.push({
      name: isLoopback(current.hostname) ? localName : current.host,
      url: currentUrl,
    })
  }
  return { instances: instances.slice(-MAX_INSTANCES) }
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

/** Remove an obsolete roster fragment without importing its contents.
 * @param history Current browser history object.
 * @param href Current page URL.
 */
export function clearLegacyInstanceTransfer(history: Pick<History, 'replaceState' | 'state'>, href: string): void {
  const url = new URL(href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  if (!fragment.has(TRANSFER_KEY)) return
  fragment.delete(TRANSFER_KEY)
  url.hash = fragment.toString()
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
