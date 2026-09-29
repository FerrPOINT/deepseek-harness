import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconPlusOutlineRegular, Input, Menu, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import type { SidebarKey } from './locales.ts'
import {
  clearTransferredRegistry, parseInstanceInput, readInitialInstanceRegistry, withInstanceRegistry,
  writeInstanceRegistry,
} from './instance-registry.ts'
import type { DshInstance, InstanceInputError } from './instance-registry.ts'
import css from './InstanceSwitcher.module.css'

const errorKeys: Record<InstanceInputError | 'name' | 'limit' | 'storage', SidebarKey> = {
  required: 'instance.error.required',
  invalid: 'instance.error.invalid',
  credentials: 'instance.error.credentials',
  path: 'instance.error.path',
  query: 'instance.error.query',
  insecure: 'instance.error.insecure',
  name: 'instance.error.name',
  limit: 'instance.error.limit',
  storage: 'instance.error.storage',
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

/** Instance selector rendered in the sidebar's expanded brand row.
 * @param props Brand mark, build version, and sidebar translator.
 * @returns The instance menu and connection dialog.
 */
export function InstanceSwitcher({ mark, buildVersion, t }: {
  mark: ReactNode
  buildVersion?: string
  t: SidebarRootComponentProps['t']
}) {
  const storage = browserStorage()
  const [initial] = useState(() => readInitialInstanceRegistry(window.location.href, storage, t('instance.local')))
  const [instances, setInstances] = useState(initial.instances)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<SidebarKey | null>(null)
  const currentUrl = window.location.origin
  const current = instances.find(instance => instance.url === currentUrl)
  const currentName = current?.name ?? t('instance.local')

  useEffect(() => {
    writeInstanceRegistry(storage, initial.instances)
    if (initial.hasTransfer) clearTransferredRegistry(window.history, window.location.href)
  }, [initial, storage])

  const openConnectionDialog = (): void => {
    setName('')
    setUrl('')
    setError(null)
    setMenuOpen(false)
    setDialogOpen(true)
  }

  const connect = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = parseInstanceInput(url)
    if ('error' in parsed) {
      setError(errorKeys[parsed.error])
      return
    }

    const existing = instances.find(instance => instance.url === parsed.instance.url)
    const normalizedName = name.trim() || existing?.name || defaultName(parsed.instance.url, t('instance.local'))
    if (normalizedName.length > 48) {
      setError(errorKeys.name)
      return
    }
    const next: DshInstance[] = existing === undefined
      ? [...instances, { ...parsed.instance, name: normalizedName }]
      : instances.map(instance => instance.url === existing.url ? { ...instance, name: normalizedName } : instance)
    if (next.length > 32) {
      setError(errorKeys.limit)
      return
    }
    if (!writeInstanceRegistry(storage, next)) {
      setError(errorKeys.storage)
      return
    }

    setInstances(next)
    setDialogOpen(false)
    setUrl('')
    window.location.assign(withInstanceRegistry(parsed.launchUrl ?? parsed.instance.url, next))
  }

  const selectInstance = (selectedUrl: string): void => {
    setMenuOpen(false)
    if (selectedUrl === currentUrl) return
    window.location.assign(withInstanceRegistry(selectedUrl, instances))
  }

  return (
    <>
      <Menu
        open={menuOpen}
        onClose={() => { setMenuOpen(false) }}
        portal
        compact
        selectedId={currentUrl}
        className={css.menuAnchor}
        listClassName={css.menuList}
        items={instances.map(instance => ({
          id: instance.url,
          label: <span className={css.itemLabel}>{instance.name}</span>,
        }))}
        onSelect={selectInstance}
        anchor={(
          <button
            type="button"
            className={css.trigger}
            aria-label={`${t('instance.switch')}: ${currentName}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(open => !open) }}
          >
            <span className={css.mark} aria-hidden="true">{mark}</span>
            <span className={css.identity}>
              <span className={css.name}>{currentName}</span>
              {buildVersion !== undefined && <span className={css.version}>{buildVersion}</span>}
            </span>
            <IconChevronDownOutlineRegular className={css.chevron} size={14} aria-hidden="true" />
          </button>
        )}
      >
        <MenuItemButton
          icon={<IconPlusOutlineRegular size={14} />}
          separatorBefore
          onSelect={openConnectionDialog}
        >
          {t('instance.add')}
        </MenuItemButton>
      </Menu>

      <Modal
        open={dialogOpen}
        onClose={() => { setDialogOpen(false) }}
        title={t('instance.dialog.title')}
        description={t('instance.dialog.description')}
        closeLabel={t('instance.cancel')}
        {...(css.dialog === undefined ? {} : { className: css.dialog })}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDialogOpen(false) }}>
              {t('instance.cancel')}
            </Button>
            <Button variant="primary" type="submit" form="instance-switcher-form">
              {t('instance.submit')}
            </Button>
          </>
        )}
      >
        <form id="instance-switcher-form" className={css.form} onSubmit={connect} noValidate>
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
      </Modal>
    </>
  )
}
