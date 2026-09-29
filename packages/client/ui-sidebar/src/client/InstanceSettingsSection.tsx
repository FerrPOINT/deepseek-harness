/** Settings section for selecting and maintaining saved DSH instances. */
import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Button, IconEditOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular, Input, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createInstanceRegistryStore } from './instance-registry-store.ts'
import type { DshInstance, InstanceInputError } from './instance-registry.ts'
import { parseInstanceInput } from './instance-registry.ts'
import type { SidebarKey } from './locales.ts'
import css from './InstanceSettingsSection.module.css'

const errorKeys: Record<InstanceInputError | 'name' | 'limit' | 'duplicate', SidebarKey> = {
  required: 'instance.error.required',
  invalid: 'instance.error.invalid',
  credentials: 'instance.error.credentials',
  path: 'instance.error.path',
  query: 'instance.error.query',
  insecure: 'instance.error.insecure',
  name: 'instance.error.name',
  limit: 'instance.error.limit',
  duplicate: 'instance.error.duplicate',
}

/** Persistence callback supplied by the sidebar registration owner. */
export interface InstanceSettingsSectionInjected {
  /** Persist the roster to this origin's browser storage. */
  writeInstances: (instances: readonly DshInstance[]) => boolean
  /** Open an instance address. */
  openInstance: (url: string) => void
}

/** Full settings-section props: shell owner, locale, shared roster store, and persistence. */
export type InstanceSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'sidebar'>
  & PropsStore<ReturnType<typeof createInstanceRegistryStore>>
  & InjectFace<InstanceSettingsSectionInjected>

function defaultName(url: string, localName: string): string {
  const parsed = new URL(url)
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
    ? localName
    : parsed.host
}

/** Render controls for the saved DSH instance roster.
 * @param props Current roster, localized copy, and persistence action.
 * @returns The instance-management settings page.
 */
export function InstanceSettingsSection({ useStore, actions, writeInstances, openInstance, t }: InstanceSettingsSectionProps) {
  const instances = useStore(state => state.instances)
  const [statusByUrl, setStatusByUrl] = useState<Record<string, 'checking' | 'available' | 'unavailable'>>({})
  const [formOpen, setFormOpen] = useState(false)
  const [editingUrl, setEditingUrl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [formError, setFormError] = useState<SidebarKey | null>(null)
  const [pageError, setPageError] = useState<SidebarKey | null>(null)
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)
  const currentUrl = window.location.origin

  const openForm = (instance?: DshInstance): void => {
    setEditingUrl(instance?.url ?? null)
    setName(instance?.name ?? '')
    setUrl(instance?.url ?? '')
    setFormError(null)
    setFormOpen(true)
  }

  const selectInstance = (instanceUrl: string): void => {
    if (instanceUrl === currentUrl) return
    openInstance(instanceUrl)
  }

  const checkInstance = (instance: DshInstance): void => {
    setStatusByUrl(previous => ({ ...previous, [instance.url]: 'checking' }))
    void fetch(instance.url, {
      method: 'HEAD',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }).then(() => {
      setStatusByUrl(previous => ({ ...previous, [instance.url]: 'available' }))
    }, () => {
      setStatusByUrl(previous => ({ ...previous, [instance.url]: 'unavailable' }))
    })
  }

  const saveInstance = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = parseInstanceInput(url)
    if ('error' in parsed) {
      setFormError(errorKeys[parsed.error])
      return
    }
    if (instances.some(instance => instance.url === parsed.instance.url && instance.url !== editingUrl)) {
      setFormError(errorKeys.duplicate)
      return
    }

    const edited = editingUrl === null ? undefined : instances.find(instance => instance.url === editingUrl)
    const nextName = name.trim() || edited?.name || defaultName(parsed.instance.url, t('instance.local'))
    if (nextName.length > 48) {
      setFormError(errorKeys.name)
      return
    }
    const next = edited === undefined
      ? [...instances, { ...parsed.instance, name: nextName }]
      : instances.map(instance => instance.url === editingUrl ? { ...parsed.instance, name: nextName } : instance)
    if (next.length > 32) {
      setFormError(errorKeys.limit)
      return
    }
    if (!writeInstances(next)) {
      setFormError('instance.error.storage')
      return
    }
    actions.setInstances(next)

    setFormOpen(false)
    setFormError(null)
    if (parsed.launchUrl !== null) openInstance(parsed.launchUrl)
  }

  const deleteInstance = (instance: DshInstance): void => {
    const next = instances.filter(candidate => candidate.url !== instance.url)
    if (next.length === 0) return
    if (!writeInstances(next)) {
      setPageError('instance.error.storage')
      return
    }
    actions.setInstances(next)
    setDeletingUrl(null)
    setPageError(null)
    if (instance.url === currentUrl) {
      const destination = next[0]
      if (destination !== undefined) openInstance(destination.url)
    }
  }

  return (
    <section className={css.section}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('instance.manage.title')}</h1>
          <p className={css.description}>{t('instance.manage.description')}</p>
        </div>
        <Button variant="primary" onClick={() => { openForm() }}>
          <IconPlusOutlineRegular size={14} />{t('instance.add')}
        </Button>
      </header>

      <div className={css.list}>
        {instances.map(instance => (
          <article className={css.card} key={instance.url}>
            <button type="button" className={css.instanceButton} onClick={() => { selectInstance(instance.url) }}>
              <span className={css.instanceName}>{instance.name}</span>
              {instance.url === currentUrl && <span className={css.current}>{t('instance.current')}</span>}
              <span className={css.instanceUrl}>{instance.url}</span>
            </button>
            <div className={css.actions}>
              <span role="status" className={css.status} data-instance-status={statusByUrl[instance.url] ?? 'unchecked'}>
                {statusByUrl[instance.url] === 'checking' ? t('instance.status.checking')
                  : statusByUrl[instance.url] === 'available' ? t('instance.status.available')
                    : statusByUrl[instance.url] === 'unavailable' ? t('instance.status.unavailable') : ''}
              </span>
              <button
                type="button"
                className={css.checkButton}
                aria-label={`${t('instance.status.check')}: ${instance.name}`}
                disabled={statusByUrl[instance.url] === 'checking'}
                onClick={() => { checkInstance(instance) }}
              >
                {t('instance.status.check')}
              </button>
              <Tooltip label={t('instance.edit')} delayMs={500}>
                <button type="button" className={css.iconButton} aria-label={`${t('instance.edit')}: ${instance.name}`} onClick={() => { openForm(instance) }}>
                  <IconEditOutlineRegular size={16} aria-hidden="true" />
                </button>
              </Tooltip>
              {deletingUrl === instance.url ? (
                <span className={css.deleteConfirm}>
                  <button type="button" onClick={() => { deleteInstance(instance) }}>{t('instance.delete.confirm')}</button>
                  <button type="button" onClick={() => { setDeletingUrl(null) }}>{t('instance.cancel')}</button>
                </span>
              ) : (
                <Tooltip label={t('instance.delete')} delayMs={500}>
                  <button
                    type="button"
                    className={css.iconButton}
                    disabled={instances.length === 1}
                    aria-label={`${t('instance.delete')}: ${instance.name}`}
                    onClick={() => { setDeletingUrl(instance.url); setPageError(null) }}
                  >
                    <IconTrashOutlineRegular size={16} aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
            </div>
          </article>
        ))}
      </div>
      {pageError !== null && <p className={css.error} role="alert">{t(pageError)}</p>}

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setFormError(null) }}
        title={editingUrl === null ? t('instance.add.title') : t('instance.edit.title')}
        description={t('instance.dialog.description')}
        closeLabel={t('instance.cancel')}
        {...(css.dialog === undefined ? {} : { className: css.dialog })}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setFormOpen(false); setFormError(null) }}>{t('instance.cancel')}</Button>
            <Button variant="primary" type="submit" form="instance-settings-form">
              {editingUrl === null ? t('instance.add.submit') : t('instance.save')}
            </Button>
          </>
        )}
      >
        <form id="instance-settings-form" className={css.form} onSubmit={saveInstance} noValidate>
          <label className={css.field} htmlFor="instance-settings-name">
            <span>{t('instance.name')}</span>
            <Input
              id="instance-settings-name"
              value={name}
              maxLength={49}
              autoComplete="off"
              onChange={(event) => { setName(event.currentTarget.value); setFormError(null) }}
            />
          </label>
          <label className={css.field} htmlFor="instance-settings-url">
            <span>{t('instance.url')}</span>
            <Input
              id="instance-settings-url"
              type="url"
              value={url}
              placeholder={t('instance.url.placeholder')}
              autoComplete="off"
              disabled={editingUrl === currentUrl}
              data-modal-autofocus
              onChange={(event) => { setUrl(event.currentTarget.value); setFormError(null) }}
            />
          </label>
          {formError !== null && <p className={css.error} role="alert">{t(formError)}</p>}
        </form>
      </Modal>
    </section>
  )
}
