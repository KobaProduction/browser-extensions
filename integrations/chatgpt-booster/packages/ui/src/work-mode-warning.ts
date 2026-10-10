import { type SupportedLocale, translate } from './i18n'
import { installBoosterShadowStyles } from './shadow-styles'

export interface WorkModeSubagentView {
  displayName: string | null
  status: 'waiting' | 'working' | 'done' | 'failed' | 'interrupted'
}

export interface MountedWorkModeWarning {
  element: HTMLElement
  update(subagents: readonly WorkModeSubagentView[]): void
  unmount(): void
}

export function mountWorkModeWarning(
  before: HTMLElement,
  initial: readonly WorkModeSubagentView[],
  locale: SupportedLocale,
): MountedWorkModeWarning {
  const host = document.createElement('div')
  host.dataset.chatgptBooster = 'work-mode-warning'
  host.style.cssText =
    'display:flex;justify-content:center;width:100%;padding:0 8px 4px;box-sizing:border-box;'
  before.insertAdjacentElement('beforebegin', host)

  const shadow = host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)
  const warning = document.createElement('div')
  warning.className = 'booster-work-mode-warning'
  warning.setAttribute('role', 'status')
  const label = document.createElement('strong')
  const details = document.createElement('span')
  warning.append(label, details)
  shadow.append(warning)

  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  let subagents = initial

  const render = () => {
    label.textContent = t('work.browserOnly')
    const active = subagents.filter(
      (agent) => agent.status === 'waiting' || agent.status === 'working',
    ).length
    details.textContent = subagents.length
      ? `${t('work.subagents')} ${subagents.length} · ${t('work.active')} ${active}`
      : ''
    details.hidden = !details.textContent
    warning.title = subagents
      .map((agent) => `${agent.displayName ?? agent.status}: ${agent.status}`)
      .join('\n')
  }

  render()

  return {
    element: host,
    update(next) {
      subagents = next
      render()
    },
    unmount() {
      host.remove()
    },
  }
}
