import type { ConversationItemMetadataView } from '@chatgpt-booster/core'
import { type SupportedLocale, translate } from './i18n'
import { installBoosterShadowStyles } from './shadow-styles'

export interface MountedMessageMetadata {
  element: HTMLElement
  update(metadata: ConversationItemMetadataView): void
  unmount(): void
}

function svgIcon(kind: 'clock' | 'brain') {
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

  const paths: Array<[string, Record<string, string>]> =
    kind === 'clock'
      ? [
          ['circle', { cx: '12', cy: '12', r: '10' }],
          ['path', { d: 'M12 6v6h4' }],
        ]
      : [
          [
            'path',
            {
              d: 'M9.5 4.5A3 3 0 0 0 6 7.5v.4A3.5 3.5 0 0 0 4 11v1a3 3 0 0 0 2 2.8V16a3 3 0 0 0 3.5 3',
            },
          ],
          [
            'path',
            {
              d: 'M14.5 4.5A3 3 0 0 1 18 7.5v.4a3.5 3.5 0 0 1 2 3.1v1a3 3 0 0 1-2 2.8V16a3 3 0 0 1-3.5 3',
            },
          ],
          ['path', { d: 'M9.5 4.5v15M14.5 4.5v15M9.5 9H7M14.5 9H17M9.5 14H7M14.5 14H17' }],
        ]

  for (const [name, attrs] of paths) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    svg.append(node)
  }
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

function sameMetadata(a: ConversationItemMetadataView, b: ConversationItemMetadataView) {
  return (
    a.sentAt === b.sentAt &&
    a.editedAt === b.editedAt &&
    a.edited === b.edited &&
    a.model === b.model &&
    a.thinking === b.thinking
  )
}

function createLines() {
  const lines = document.createElement('div')
  lines.className = 'booster-meta-lines'
  return lines
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

function createHoverPopover(icon: SVGElement) {
  const trigger = document.createElement('span')
  trigger.className = 'booster-meta-trigger'
  trigger.tabIndex = 0
  trigger.setAttribute('role', 'button')
  trigger.append(icon)

  const popup = document.createElement('div')
  popup.className = 'booster-floating-popover'
  popup.setAttribute('popover', 'manual')

  let open = false
  const position = () => {
    if (!open) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(340, Math.max(180, popup.offsetWidth || 260))
    const maxLeft = Math.max(8, innerWidth - width - 8)
    const left = Math.max(8, Math.min(maxLeft, rect.right - width))
    const panelHeight = popup.offsetHeight || 80
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
    position()
  }
  const hide = () => {
    if (!open) return
    open = false
    popup.classList.remove('is-open')
    window.removeEventListener('resize', position)
    window.removeEventListener('scroll', position, true)
    try {
      popup.hidePopover?.()
    } catch {}
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide()
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) hide()
      else show()
    }
  }
  trigger.addEventListener('mouseenter', show)
  trigger.addEventListener('mouseleave', hide)
  trigger.addEventListener('focus', show)
  trigger.addEventListener('blur', hide)
  trigger.addEventListener('keydown', key)

  return {
    trigger,
    popup,
    hide,
    unmount() {
      hide()
      trigger.removeEventListener('mouseenter', show)
      trigger.removeEventListener('mouseleave', hide)
      trigger.removeEventListener('focus', show)
      trigger.removeEventListener('blur', hide)
      trigger.removeEventListener('keydown', key)
    },
  }
}

export function mountMessageMetadata(
  into: HTMLElement,
  metadata: ConversationItemMetadataView,
  locale: SupportedLocale,
  showModel: boolean,
): MountedMessageMetadata {
  const host = document.createElement('span')
  host.dataset.chatgptBooster = 'message-metadata'
  host.style.display = 'inline-flex'
  host.style.alignItems = 'center'
  host.style.height = '32px'
  into.append(host)

  const shadow = host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)
  const badges = document.createElement('span')
  badges.className = 'booster-meta-badges compact'
  shadow.append(badges)

  const time = createHoverPopover(svgIcon('clock'))
  const model = createHoverPopover(svgIcon('brain'))
  badges.append(time.trigger, time.popup, model.trigger, model.popup)

  const render = (next: ConversationItemMetadataView) => {
    const sent = fullDate(next.sentAt, locale)
    const edited = fullDate(next.editedAt, locale)
    const sentLabel = translate(locale, 'reader.sentAt')
    const editedLabel = translate(locale, 'reader.editedAt')
    const unknown = translate(locale, 'reader.timeUnknown')
    const timeLabel = [sent ? `${sentLabel}: ${sent}` : unknown]
    if (next.edited && edited) timeLabel.push(`${editedLabel}: ${edited}`)
    time.trigger.setAttribute('aria-label', timeLabel.join('\n'))
    time.popup.replaceChildren()
    const timeLines = createLines()
    appendLine(timeLines, sentLabel, sent || unknown)
    if (next.edited && edited) appendLine(timeLines, editedLabel, edited)
    time.popup.append(timeLines)

    const modelLabel = translate(locale, 'reader.model')
    const thinkingLabel = translate(locale, 'reader.thinking')
    const modelParts = [
      next.model ? `${modelLabel}: ${next.model}` : '',
      next.thinking ? `${thinkingLabel}: ${next.thinking}` : '',
    ].filter(Boolean)
    const visible = showModel && modelParts.length > 0
    model.trigger.hidden = !visible
    model.popup.hidden = !visible
    if (!visible) {
      model.hide()
      return
    }
    model.trigger.setAttribute('aria-label', modelParts.join('\n'))
    model.popup.replaceChildren()
    const modelLines = createLines()
    if (next.model) appendLine(modelLines, modelLabel, next.model)
    if (next.thinking) appendLine(modelLines, thinkingLabel, next.thinking)
    model.popup.append(modelLines)
  }

  let current = { ...metadata }
  render(current)

  return {
    element: host,
    update(next) {
      if (sameMetadata(current, next)) return
      current = { ...next }
      render(current)
    },
    unmount() {
      time.unmount()
      model.unmount()
      host.remove()
    },
  }
}
