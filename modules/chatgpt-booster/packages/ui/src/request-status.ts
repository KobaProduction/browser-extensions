import type { AgentActivitySnapshot } from '@chatgpt-booster/core'
import { ensureSiteDecoration } from '@kobaproduction/browser-ui'
import { type SupportedLocale, translate } from './i18n'
import { installBoosterShadowStyles } from './shadow-styles'

export interface MountedRequestStatus {
  element: HTMLElement
  update(snapshot: AgentActivitySnapshot): void
  tick(now: number): void
  unmount(): void
}

function elapsed(since: number | null, until: number | null, now: number) {
  if (!since) return '—'
  const ms = Math.max(0, (until ?? now) - since)
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function mountRequestStatus(
  before: HTMLElement,
  initial: AgentActivitySnapshot,
  locale: SupportedLocale,
): MountedRequestStatus {
  return ensureSiteDecoration({
    anchor: before,
    kind: 'chatgpt-booster:request-status',
    identity: locale,
    placement: 'before',
    legacyBoundarySelector: '[data-chatgpt-booster]',
    legacySelector: '[data-chatgpt-booster="request-status"]',
    update: (current) => current.update(initial),
    create: () => {
      const host = document.createElement('div')
      host.dataset.chatgptBooster = 'request-status'
      host.style.cssText =
        'display:flex;justify-content:center;width:100%;padding:0 8px 4px;box-sizing:border-box;'
      before.insertAdjacentElement('beforebegin', host)

      const shadow = host.attachShadow({ mode: 'open' })
      installBoosterShadowStyles(shadow)
      const bar = document.createElement('div')
      bar.className = 'booster-request-status'
      const spinner = document.createElement('span')
      spinner.className = 'booster-request-spinner'
      spinner.setAttribute('aria-hidden', 'true')
      const request = document.createElement('span')
      const requestLabel = document.createElement('span')
      requestLabel.className = 'booster-request-status-label'
      const requestTimer = document.createElement('strong')
      const reasoning = document.createElement('span')
      const reasoningLabel = document.createElement('span')
      reasoningLabel.className = 'booster-request-status-label'
      const reasoningTimer = document.createElement('strong')
      const action = document.createElement('span')
      const actionLabel = document.createElement('span')
      actionLabel.className = 'booster-request-status-label'
      const actionTimer = document.createElement('strong')
      const update = document.createElement('span')
      const updateLabel = document.createElement('span')
      updateLabel.className = 'booster-request-status-label'
      const updateTimer = document.createElement('strong')
      const summary = document.createElement('span')
      const summaryLabel = document.createElement('span')
      summaryLabel.className = 'booster-request-status-label'
      const summaryTimer = document.createElement('strong')
      const interval = document.createElement('span')
      const intervalLabel = document.createElement('span')
      intervalLabel.className = 'booster-request-status-label'
      const intervalTimer = document.createElement('strong')
      request.append(requestLabel, requestTimer)
      reasoning.append(reasoningLabel, reasoningTimer)
      action.append(actionLabel, actionTimer)
      update.append(updateLabel, updateTimer)
      summary.append(summaryLabel, summaryTimer)
      interval.append(intervalLabel, intervalTimer)
      bar.append(spinner, request, reasoning, action, update, summary, interval)
      shadow.append(bar)

      let snapshot = initial
      let currentNow = Date.now()
      const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
      requestLabel.textContent = t('requestStatus.request')
      reasoningLabel.textContent = t('requestStatus.reasoning')
      actionLabel.textContent = t('requestStatus.action')
      updateLabel.textContent = t('requestStatus.unchanged')
      summaryLabel.textContent = t('requestStatus.sinceSummary')
      intervalLabel.textContent = t('requestStatus.summaryInterval')

      const render = () => {
        requestTimer.textContent = elapsed(snapshot.startedAt, snapshot.completedAt, currentNow)
        reasoning.hidden = snapshot.phase !== 'thinking' || !snapshot.reasoningStartedAt
        reasoningTimer.textContent = elapsed(
          snapshot.reasoningStartedAt,
          snapshot.completedAt,
          currentNow,
        )
        spinner.hidden = !snapshot.active
        action.hidden = snapshot.phase === 'thinking' || !snapshot.phaseStartedAt
        actionTimer.textContent = elapsed(snapshot.phaseStartedAt, snapshot.completedAt, currentNow)
        update.hidden = !snapshot.lastActivityAt
        updateTimer.textContent = snapshot.lastActivityAt
          ? `${elapsed(snapshot.lastActivityAt, snapshot.completedAt, currentNow)} ${t('requestStatus.ago')}`
          : '—'
        summary.hidden = true
        summaryTimer.textContent = elapsed(
          snapshot.lastSummaryAt ?? null,
          snapshot.completedAt,
          currentNow,
        )
        interval.hidden = true
        intervalTimer.textContent = elapsed(
          snapshot.previousSummaryAt ?? null,
          snapshot.lastSummaryAt ?? null,
          currentNow,
        )
        bar.title = [
          snapshot.lastSummaryAt ? `${t('requestStatus.sinceSummary')} ${summaryTimer.textContent}` : '',
          snapshot.previousSummaryAt && snapshot.lastSummaryAt
            ? `${t('requestStatus.summaryInterval')} ${intervalTimer.textContent}`
            : '',
        ]
          .filter(Boolean)
          .join(' · ')
        bar.dataset.phase = snapshot.phase
        bar.setAttribute(
          'aria-label',
          [...bar.children]
            .filter((element) => !(element as HTMLElement).hidden && element !== spinner)
            .map((element) => [...element.children].map((child) => child.textContent).join(' '))
            .join(', '),
        )
      }
      render()

      return {
        element: host,
        update(next) {
          snapshot = next
          render()
        },
        tick(now) {
          currentNow = now
          render()
        },
        unmount() {
          host.remove()
        },
      }
    },
  })
}
