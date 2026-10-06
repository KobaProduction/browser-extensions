import type { AgentActivitySnapshot, ConversationItemMetadataView } from '@chatgpt-booster/core'
import { type SupportedLocale, translate } from './i18n'
import { installBoosterShadowStyles } from './shadow-styles'

export interface LiveMessageMetadataView extends ConversationItemMetadataView {
  raw?: unknown
  activity?: AgentActivitySnapshot | null
}

export interface MountedMessageMetadata {
  element: HTMLElement
  update(metadata: LiveMessageMetadataView): void
  updateActivity(activity: AgentActivitySnapshot | null): void
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
  circle.setAttribute('r', '10')
  const hand = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  hand.setAttribute('d', 'M12 6v6h4')
  svg.append(circle, hand)
  return svg
}

function serverTime(value: number | null) {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}

function fullDate(value: number | null, locale: SupportedLocale) {
  const time = serverTime(value)
  return time ? new Date(time).toLocaleString(locale) : null
}

function shortTime(value: number | null, locale: SupportedLocale) {
  const time = serverTime(value)
  return time
    ? new Date(time).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'
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

function appendLine(container: HTMLElement, label: string, value: string) {
  const strong = document.createElement('strong')
  strong.className = 'booster-meta-label'
  strong.textContent = label
  const span = document.createElement('span')
  span.className = 'booster-meta-value'
  span.textContent = value
  container.append(strong, span)
}

function createClickPopover(icon: SVGElement) {
  const trigger = document.createElement('span')
  trigger.className = 'booster-meta-trigger booster-meta-trigger-time is-clickable'
  trigger.tabIndex = 0
  trigger.setAttribute('role', 'button')
  trigger.append(icon)

  const popup = document.createElement('div')
  popup.className = 'booster-floating-popover booster-message-meta-popover is-interactive'
  popup.setAttribute('popover', 'manual')

  let open = false
  const position = () => {
    if (!open) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(420, Math.max(220, popup.offsetWidth || 300))
    const maxLeft = Math.max(8, innerWidth - width - 8)
    const left = Math.max(8, Math.min(maxLeft, rect.right - width))
    const panelHeight = popup.offsetHeight || 120
    const below = rect.bottom + 8
    const top =
      below + panelHeight <= innerHeight - 8 ? below : Math.max(8, rect.top - panelHeight - 8)
    popup.style.left = `${left}px`
    popup.style.top = `${top}px`
  }
  const show = () => {
    if (open) return position()
    open = true
    popup.classList.add('is-open')
    try {
      popup.showPopover?.()
    } catch {}
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('pointerdown', outside, true)
    position()
  }
  const hide = () => {
    if (!open) return
    open = false
    popup.classList.remove('is-open')
    window.removeEventListener('resize', position)
    window.removeEventListener('scroll', position, true)
    document.removeEventListener('pointerdown', outside, true)
    try {
      popup.hidePopover?.()
    } catch {}
  }
  const toggle = () => {
    if (open) hide()
    else show()
  }
  function outside(event: PointerEvent) {
    const path = event.composedPath()
    if (path.includes(trigger) || path.includes(popup)) return
    hide()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide()
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }
  const click = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    toggle()
  }
  trigger.addEventListener('click', click)
  trigger.addEventListener('keydown', key)

  return {
    trigger,
    popup,
    hide,
    unmount() {
      hide()
      trigger.removeEventListener('click', click)
      trigger.removeEventListener('keydown', key)
    },
  }
}

export function mountMessageMetadata(
  into: HTMLElement,
  initial: LiveMessageMetadataView,
  locale: SupportedLocale,
): MountedMessageMetadata {
  const host = document.createElement('span')
  host.dataset.chatgptBooster = 'message-metadata'
  host.style.cssText =
    'display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:auto;min-width:0;height:28px;margin:0;'
  into.append(host)

  const shadow = host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)
  const control = createClickPopover(clockIcon())
  const timeText = document.createElement('span')
  timeText.className = 'booster-meta-time-text'
  control.trigger.append(timeText)
  shadow.append(control.trigger, control.popup)

  let current: LiveMessageMetadataView = { ...initial }
  let rawExpanded = false

  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)

  const render = () => {
    const sent = fullDate(current.sentAt, locale)
    const edited = fullDate(current.editedAt, locale)
    const unknown = t('reader.timeUnknown')
    timeText.textContent = shortTime(current.sentAt, locale)
    control.trigger.title = sent ? `${t('reader.sentAt')}: ${sent}` : unknown
    control.trigger.setAttribute('aria-label', control.trigger.title)

    const body = document.createElement('div')
    body.className = 'booster-message-meta-body'
    const lines = document.createElement('div')
    lines.className = 'booster-meta-lines'
    appendLine(lines, t('reader.sentAt'), sent || unknown)
    if (current.edited && edited) appendLine(lines, t('reader.editedAt'), edited)
    if (current.model) appendLine(lines, t('reader.model'), current.model)
    if (current.thinking) appendLine(lines, t('reader.thinking'), current.thinking)

    const activity = current.activity
    if (activity) {
      const activityDuration =
        activity.durationMs ??
        (activity.startedAt && activity.lastActivityAt
          ? Math.max(0, activity.lastActivityAt - activity.startedAt)
          : null)
      if (activityDuration !== null)
        appendLine(lines, t('activity.duration'), duration(activityDuration))
      if (activity.startedAt)
        appendLine(
          lines,
          t('activity.startedAt'),
          new Date(activity.startedAt).toLocaleString(locale),
        )
      if (activity.lastActivityAt)
        appendLine(
          lines,
          t('activity.lastActivityAt'),
          new Date(activity.lastActivityAt).toLocaleString(locale),
        )
    }
    body.append(lines)

    if (current.raw !== undefined && current.raw !== null) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'booster-meta-raw-toggle'
      toggle.textContent = rawExpanded ? t('archive.hideRaw') : t('archive.showRaw')
      const pre = document.createElement('pre')
      pre.className = 'booster-message-meta-raw'
      pre.hidden = !rawExpanded
      try {
        pre.textContent = JSON.stringify(current.raw, null, 2)
      } catch {
        pre.textContent = String(current.raw)
      }
      toggle.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        rawExpanded = !rawExpanded
        render()
      })
      body.append(toggle, pre)
    }

    control.popup.replaceChildren(body)
  }

  render()

  return {
    element: host,
    update(next) {
      current = { ...next, activity: next.activity ?? current.activity ?? null }
      render()
    },
    updateActivity(activity) {
      current = { ...current, activity }
      render()
    },
    unmount() {
      control.unmount()
      host.remove()
    },
  }
}
