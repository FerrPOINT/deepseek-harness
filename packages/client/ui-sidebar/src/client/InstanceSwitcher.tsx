import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import type { DshInstance } from './instance-registry.ts'
import css from './InstanceSwitcher.module.css'

/** Instance selector rendered beside the brand mark in the sidebar.
 * @param props Brand mark, build version, and sidebar translator.
 * @returns A styled DSH instance menu.
 */
export function InstanceSwitcher({ mark, buildVersion, t, useStore, openInstance }: {
  mark: ReactNode
  buildVersion?: string
  t: SidebarRootComponentProps['t']
  useStore: SidebarRootComponentProps['useStore']
  openInstance: SidebarRootComponentProps['openInstance']
}) {
  const instances = useStore(state => state.instances)
  const [menuOpen, setMenuOpen] = useState(false)
  const currentUrl = window.location.origin
  const current = instances.find(instance => instance.url === currentUrl)
  const currentName = current?.name ?? t('instance.local')

  const selectInstance = (selectedUrl: string): void => {
    setMenuOpen(false)
    if (selectedUrl === currentUrl) return
    openInstance(selectedUrl)
  }

  return (
    <Menu
      open={menuOpen}
      onClose={() => { setMenuOpen(false) }}
      portal
      compact
      selectedId={currentUrl}
      className={css.menuAnchor}
      listClassName={css.menuList}
      items={instances.map((instance: DshInstance) => ({
        id: instance.url,
        label: (
          <span className={css.optionLabel}>
            <span className={css.optionName}>{instance.name}</span>
            <span className={css.optionUrl}>{instance.url}</span>
          </span>
        ),
      }))}
      onSelect={selectInstance}
      anchor={(
        <button
          type="button"
          className={css.instanceTrigger}
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
    />
  )
}
