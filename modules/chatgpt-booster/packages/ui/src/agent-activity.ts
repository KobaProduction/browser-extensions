import type { AgentActivitySnapshot } from '@chatgpt-booster/core'
import { type SupportedLocale, translate } from './i18n'
import { installBoosterShadowStyles } from './shadow-styles'

export interface MountedAgentActivity {
  element: HTMLElement
  update(snapshot: AgentActivitySnapshot): void
  tick(now: number): void
  unmount(): void
}

function clockIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttribute('cx', '12')
  circle.setAttribute('cy', '12')
  circle.setAttribute('r', '9')
  const hand = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  hand.setAttribute('d', 'M12 7v5l3 2')
  svg.append(circle, hand)
  return svg
}

function elapsed(since: number | null, until: number | null, now: number) {
  if (!since) return '—'
  const ms = Math.max(0, (until ?? now) - since)
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function duration(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  const ms = Math.max(0, value)
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function normalizedLabel(value: string | null) {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text) return ''
  const match = text.match(/^(.{2,}?)\1$/u)
  return match?.[1]?.trim() || text
}

export function mountAgentActivity(
  into: HTMLElement,
  initial: AgentActivitySnapshot,
  locale: SupportedLocale,
): MountedAgentActivity {
  const host = document.createElement('div')
  host.dataset.chatgptBooster = 'agent-activity'
  host.style.display = 'flex'
  host.style.width = '100%'
  host.style.justifyContent = 'flex-start'
  host.style.marginTop = '2px'
  into.append(host)

  const shadow = host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)
  const pill = document.createElement('div')
  pill.className = 'booster-agent-activity'
  const icon = clockIcon()
  const phase = document.createElement('span')
  phase.className = 'booster-agent-activity-phase'
  const label = document.createElement('span')
  label.className = 'booster-agent-activity-label'
  const timer = document.createElement('strong')
  timer.className = 'booster-agent-activity-timer'
  pill.append(icon, phase, label, timer)
  shadow.append(pill)

  let snapshot = initial
  let currentNow = Date.now()
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)

  const phaseLabel = () => {
    if (snapshot.phase === 'tool') return t('activity.tool')
    if (snapshot.phase === 'responding') return t('activity.responding')
    if (snapshot.phase === 'thinking') return t('activity.thinking')
    if (snapshot.phase === 'complete') return t('activity.complete')
    return t('activity.idle')
  }

  const renderStatic = () => {
    pill.dataset.phase = snapshot.phase
    phase.textContent = phaseLabel()
    const rawLabel =
      snapshot.label && snapshot.label !== snapshot.tool?.label
        ? snapshot.label
        : (snapshot.tool?.label ?? '')
    label.textContent = snapshot.phase === 'tool' ? normalizedLabel(rawLabel) : ''
    label.hidden = !label.textContent
    pill.removeAttribute('title')
    pill.setAttribute(
      'aria-label',
      `${phaseLabel()}, ${t('activity.duration')} ${elapsed(snapshot.phaseStartedAt, snapshot.completedAt, currentNow)}`,
    )
  }
  const renderTimer = () => {
    if (snapshot.phase === 'complete') {
      timer.textContent = duration(
        snapshot.durationMs ??
          (snapshot.startedAt && snapshot.lastActivityAt
            ? Math.max(0, snapshot.lastActivityAt - snapshot.startedAt)
            : null),
      )
      pill.setAttribute(
        'aria-label',
        `${phaseLabel()}, ${t('activity.duration')} ${timer.textContent}`,
      )
      return
    }
    const timerStart =
      snapshot.phase === 'thinking'
        ? (snapshot.reasoningStartedAt ?? snapshot.startedAt)
        : (snapshot.phaseStartedAt ?? snapshot.startedAt)
    timer.textContent = elapsed(timerStart, snapshot.completedAt, currentNow)
    pill.setAttribute(
      'aria-label',
      `${phaseLabel()}, ${t('activity.duration')} ${timer.textContent}`,
    )
  }

  renderStatic()
  renderTimer()

  return {
    element: host,
    update(next) {
      snapshot = next
      renderStatic()
      renderTimer()
    },
    tick(now) {
      currentNow = now
      renderTimer()
    },
    unmount() {
      host.remove()
    },
  }
}
