import type { AgentActivitySnapshot } from '@chatgpt-booster/core'
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
  request.append(requestLabel, requestTimer)
  reasoning.append(reasoningLabel, reasoningTimer)
  bar.append(spinner, request, reasoning)
  shadow.append(bar)

  let snapshot = initial
  let currentNow = Date.now()
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  requestLabel.textContent = t('requestStatus.request')
  reasoningLabel.textContent = t('requestStatus.reasoning')

  const render = () => {
    requestTimer.textContent = elapsed(snapshot.startedAt, snapshot.completedAt, currentNow)
    reasoning.hidden = !snapshot.reasoningStartedAt
    reasoningTimer.textContent = elapsed(
      snapshot.reasoningStartedAt,
      snapshot.completedAt,
      currentNow,
    )
    bar.dataset.phase = snapshot.phase
    bar.setAttribute(
      'aria-label',
      `${t('requestStatus.request')} ${requestTimer.textContent}${
        snapshot.reasoningStartedAt
          ? `, ${t('requestStatus.reasoning')} ${reasoningTimer.textContent}`
          : ''
      }`,
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
}
