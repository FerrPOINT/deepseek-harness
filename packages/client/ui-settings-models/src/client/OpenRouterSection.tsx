import { useCallback, useEffect, useState } from 'react'
import type { LlmProviderUsage } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './OpenRouterSection.module.css'

const REFRESH_INTERVAL_MS = 60_000

/** Host operation injected into the OpenRouter usage page. */
export interface OpenRouterSectionInjected {
  /** Read the current key's normalized usage without exposing its credential. */
  loadUsage: () => Promise<LlmProviderUsage | undefined>
}

/** Composed OpenRouter usage section props. */
export type OpenRouterSectionProps =
  PropsLocale<'settings.openrouter'> & InjectFace<OpenRouterSectionInjected>

function money(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value)
}

/** OpenRouter billing counters with a visible refresh and a tab-local live interval. */
export function OpenRouterSection({ t, loadUsage }: OpenRouterSectionProps) {
  const [usage, setUsage] = useState<LlmProviderUsage | undefined>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await loadUsage()
      setUsage(next)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [loadUsage])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, REFRESH_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [refresh])

  const period = usage?.limitReset ?? 'monthly'
  const periodUsage = usage === undefined ? undefined
    : period === 'daily' ? usage.dailyUsage : period === 'weekly' ? usage.weeklyUsage : usage.monthlyUsage
  const consumed = usage?.limit !== undefined && usage.limit > 0 && usage.limitRemaining !== undefined
    ? Math.min(100, Math.max(0, ((usage.limit - usage.limitRemaining) / usage.limit) * 100))
    : undefined

  return (
    <section className={css.section} aria-label={t('nav')}>
      <header className={css.heading}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => { void refresh() }}>
          {loading ? t('refreshing') : t('refresh')}
        </Button>
      </header>

      {usage === undefined && loading && <div className={css.status} role="status">{t('loading')}</div>}
      {usage === undefined && !loading && failed && <div className={css.statusError} role="alert">
        <span>{t('loadFailed')}</span>
        <Button variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button>
      </div>}
      {usage === undefined && !loading && !failed && <div className={css.status} role="status">{t('unsupported')}</div>}

      {usage !== undefined && <>
        {failed && <p className={css.stale} role="status">{t('refreshFailed')}</p>}
        <div className={css.summaryCard}>
          <div className={css.primaryMetric}>
            <span className={css.metricLabel}>{t('remaining')}</span>
            <strong className={css.primaryValue}>{usage.limitRemaining === undefined ? '—' : money(usage.limitRemaining)}</strong>
            <span className={css.metricHint}>{usage.limit === undefined ? t('noLimit') : t('ofLimit').replace('{limit}', money(usage.limit))}</span>
          </div>
          <div className={css.limitMetric}>
            <span className={css.metricLabel}>{t(`${period}Usage`)}</span>
            <strong className={css.limitValue}>{periodUsage === undefined ? '—' : money(periodUsage)}</strong>
          </div>
          {consumed !== undefined && <div className={css.progress} aria-label={t('limitUsed')} aria-valuenow={consumed}
            aria-valuemin={0} aria-valuemax={100} role="progressbar">
            <span style={{ width: `${String(consumed)}%` }} />
          </div>}
        </div>

        <div className={css.metrics}>
          <div className={css.metric}><span>{t('today')}</span><strong>{money(usage.dailyUsage)}</strong></div>
          <div className={css.metric}><span>{t('week')}</span><strong>{money(usage.weeklyUsage)}</strong></div>
          <div className={css.metric}><span>{t('month')}</span><strong>{money(usage.monthlyUsage)}</strong></div>
          <div className={css.metric}><span>{t('allTime')}</span><strong>{money(usage.totalUsage)}</strong></div>
        </div>

        <div className={css.footer}>
          <span>{t('updated').replace('{time}', new Date(usage.observedAt).toLocaleTimeString())}</span>
          <div className={css.links}>
            <a href="https://openrouter.ai/activity" target="_blank" rel="noopener noreferrer">{t('activity')}<IconRightUpOutlineRegular size={12} /></a>
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">{t('keys')}<IconRightUpOutlineRegular size={12} /></a>
            <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">{t('credits')}<IconRightUpOutlineRegular size={12} /></a>
          </div>
        </div>
      </>}
    </section>
  )
}
