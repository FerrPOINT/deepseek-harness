import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Button, IconEditOutlineRegular, IconPlusOutlineRegular, IconSettingsOutlineRegular, IconTrashOutlineRegular, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import type { SidebarKey } from './locales.ts'
import {
  clearTransferredRegistry, parseInstanceInput, readInitialInstanceRegistry, withInstanceRegistry,
  writeInstanceRegistry,
} from './instance-registry.ts'
import type { DshInstance, InstanceInputError } from './instance-registry.ts'
import css from './InstanceSwitcher.module.css'

const errorKeys: Record<InstanceInputError | 'name' | 'limit' | 'storage' | 'duplicate', SidebarKey> = {
  required: 'instance.error.required',
  invalid: 'instance.error.invalid',
  credentials: 'instance.error.credentials',
  path: 'instance.error.path',
  query: 'instance.error.query',
  insecure: 'instance.error.insecure',
  name: 'instance.error.name',
  limit: 'instance.error.limit',
  storage: 'instance.error.storage',
  duplicate: 'instance.error.duplicate',
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function defaultName(url: string, localName: string): string {
  const parsed = new URL(url)
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
    ? localName
    : parsed.host
}

/** Instance selector and instance-management dialog for the sidebar brand row.
 * @param props Brand mark, build version, and sidebar translator.
 * @returns The active-instance select and instance-management dialog.
 */
export function InstanceSwitcher({ mark, buildVersion, t }: {
  mark: ReactNode
  buildVersion?: string
  t: SidebarRootComponentProps['t']
}) {
  const storage = browserStorage()
  const [initial] = useState(() => readInitialInstanceRegistry(window.location.href, storage, t('instance.local')))
  const [instances, setInstances] = useState(initial.instances)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [editingUrl, setEditingUrl] = useState<string | null>(null)
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)
  const [error, setError] = useState<SidebarKey | null>(null)
  const currentUrl = window.location.origin

  useEffect(() => {
    writeInstanceRegistry(storage, initial.instances)
    if (initial.hasTransfer) clearTransferredRegistry(window.history, window.location.href)
  }, [initial, storage])

  const persist = (next: DshInstance[]): boolean => {
    if (!writeInstanceRegistry(storage, next)) {
      setError(errorKeys.storage)
      return false
    }
    setInstances(next)
    return true
  }

  const openForm = (instance?: DshInstance): void => {
    setEditingUrl(instance?.url ?? null)
    setName(instance?.name ?? '')
    setUrl(instance?.url ?? '')
    setError(null)
    setFormOpen(true)
  }

  const closeDialog = (): void => {
    setDialogOpen(false)
    setFormOpen(false)
    setDeletingUrl(null)
    setError(null)
  }

  const selectInstance = (selectedUrl: string): void => {
    if (selectedUrl === currentUrl) return
    window.location.assign(withInstanceRegistry(selectedUrl, instances))
  }

  const saveInstance = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = parseInstanceInput(url)
    if ('error' in parsed) {
      setError(errorKeys[parsed.error])
      return
    }

    const collision = instances.find(instance => instance.url === parsed.instance.url && instance.url !== editingUrl)
    if (collision !== undefined) {
      setError(errorKeys.duplicate)
      return
    }
    const edited = editingUrl === null ? undefined : instances.find(instance => instance.url === editingUrl)
    const normalizedName = name.trim() || edited?.name || defaultName(parsed.instance.url, t('instance.local'))
    if (normalizedName.length > 48) {
      setError(errorKeys.name)
      return
    }
    const next: DshInstance[] = edited === undefined
      ? [...instances, { ...parsed.instance, name: normalizedName }]
      : instances.map(instance => instance.url === editingUrl ? { ...parsed.instance, name: normalizedName } : instance)
    if (next.length > 32) {
      setError(errorKeys.limit)
      return
    }
    if (!persist(next)) return

    setFormOpen(false)
    setError(null)
    if (parsed.launchUrl !== null || parsed.instance.url !== currentUrl) {
      window.location.assign(withInstanceRegistry(parsed.launchUrl ?? parsed.instance.url, next))
    }
  }

  const deleteInstance = (instance: DshInstance): void => {
    const next = instances.filter(candidate => candidate.url !== instance.url)
    if (next.length === 0) {
      setError('instance.error.last')
      return
    }
    if (!persist(next)) return
    setDeletingUrl(null)
    if (instance.url === currentUrl) {
      const destination = next[0]
      if (destination !== undefined) window.location.assign(withInstanceRegistry(destination.url, next))
    }
  }

  return (
    <>
      <div className={css.brandControl}>
        <span className={css.mark} aria-hidden="true">{mark}</span>
        <label className={css.selectWrap}>
          <span className={css.srOnly}>{t('instance.switch')}</span>
          <select className={css.select} value={currentUrl} onChange={(event) => { selectInstance(event.currentTarget.value) }}>
            {instances.map(instance => <option key={instance.url} value={instance.url}>{instance.name}</option>)}
          </select>
          {buildVersion !== undefined && <span className={css.version}>{buildVersion}</span>}
        </label>
        <button
          type="button"
          className={css.settingsButton}
          aria-label={t('instance.manage')}
          title={t('instance.manage')}
          onClick={() => { setDialogOpen(true); setFormOpen(false); setError(null) }}
        >
          <IconSettingsOutlineRegular size={16} aria-hidden="true" />
        </button>
      </div>

      <Modal
        open={dialogOpen}
        onClose={closeDialog}
        title={formOpen ? (editingUrl === null ? t('instance.add.title') : t('instance.edit.title')) : t('instance.manage.title')}
        description={formOpen ? t('instance.dialog.description') : t('instance.manage.description')}
        closeLabel={t('instance.cancel')}
        {...(css.dialog === undefined ? {} : { className: css.dialog })}
        footer={formOpen ? (
          <>
            <Button variant="outline" onClick={() => { setFormOpen(false); setError(null) }}>{t('instance.back')}</Button>
            <Button variant="primary" type="submit" form="instance-switcher-form">{t('instance.submit')}</Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => { openForm() }}>
            <IconPlusOutlineRegular size={14} />{t('instance.add')}
          </Button>
        )}
      >
        {formOpen ? (
          <form id="instance-switcher-form" className={css.form} onSubmit={saveInstance} noValidate>
            <label className={css.field} htmlFor="instance-switcher-name">
              <span>{t('instance.name')}</span>
              <Input
                id="instance-switcher-name"
                value={name}
                maxLength={49}
                autoComplete="off"
                onChange={(event) => { setName(event.currentTarget.value); setError(null) }}
              />
            </label>
            <label className={css.field} htmlFor="instance-switcher-url">
              <span>{t('instance.url')}</span>
              <Input
                id="instance-switcher-url"
                type="url"
                value={url}
                placeholder={t('instance.url.placeholder')}
                autoComplete="off"
                data-modal-autofocus
                onChange={(event) => { setUrl(event.currentTarget.value); setError(null) }}
              />
            </label>
            {error !== null && <p className={css.error} role="alert">{t(error)}</p>}
          </form>
        ) : (
          <div className={css.instanceList}>
            {instances.map(instance => (
              <div className={css.instanceRow} key={instance.url}>
                <button type="button" className={css.instanceSelect} onClick={() => { selectInstance(instance.url) }}>
                  <span className={css.instanceName}>{instance.name}{instance.url === currentUrl ? ` · ${t('instance.current')}` : ''}</span>
                  <span className={css.instanceUrl}>{instance.url}</span>
                </button>
                <button type="button" className={css.rowAction} aria-label={`${t('instance.edit')}: ${instance.name}`} title={t('instance.edit')} onClick={() => { openForm(instance) }}>
                  <IconEditOutlineRegular size={14} aria-hidden="true" />
                </button>
                {deletingUrl === instance.url ? (
                  <span className={css.deleteConfirm}>
                    <button type="button" onClick={() => { deleteInstance(instance) }}>{t('instance.delete.confirm')}</button>
                    <button type="button" onClick={() => { setDeletingUrl(null) }}>{t('instance.cancel')}</button>
                  </span>
                ) : (
                  <button type="button" className={css.rowAction} disabled={instances.length === 1} aria-label={`${t('instance.delete')}: ${instance.name}`} title={t('instance.delete')} onClick={() => { setDeletingUrl(instance.url); setError(null) }}>
                    <IconTrashOutlineRegular size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {error !== null && <p className={css.error} role="alert">{t(error)}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}
