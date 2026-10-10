import type { ArchiveCaptureContext, CaptureRuleSource } from '@chatgpt-booster/core'
import { type App, createApp, reactive } from 'vue'
import type { SupportedLocale } from './i18n'
import { translate } from './i18n'
import ScopeArchiveControl from './ScopeArchiveControl.vue'
import { installBoosterShadowStyles } from './shadow-styles'

export interface ScopeArchiveControlModel {
  context: ArchiveCaptureContext
  locale: SupportedLocale
  archivedCount: number
  effectiveEnabled: boolean
  workConversation: boolean
  source: CaptureRuleSource
  hasOverride: boolean
  onSetEnabled(enabled: boolean): void | Promise<void>
  onInherit(): void | Promise<void>
  onSettings(): void
}

export interface MountedScopeArchiveControl {
  update(model: ScopeArchiveControlModel): void
  unmount(): void
}

function conversationLabel(model: ScopeArchiveControlModel) {
  const title =
    model.context.title ||
    translate(
      model.locale,
      model.context.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled',
    )
  const archive = translate(model.locale, model.effectiveEnabled ? 'dock.autoOn' : 'dock.autoOff')
  return model.workConversation
    ? `${title} · ${translate(model.locale, 'work.browserOnly')} · ${archive}`
    : `${title} · ${archive}`
}

export function mountScopeArchiveControl(
  host: HTMLElement,
  initial: ScopeArchiveControlModel,
): MountedScopeArchiveControl {
  let shadow: ShadowRoot | undefined
  let current = initial
  let app: App | undefined
  let projectModel: ScopeArchiveControlModel | undefined
  let marker: HTMLSpanElement | undefined

  const ensureShadow = () => {
    shadow ??= host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    return shadow
  }

  const unmountVue = () => {
    app?.unmount()
    app = undefined
    projectModel = undefined
  }

  const updateConversationMarker = () => {
    if (!marker) return
    marker.title = conversationLabel(current)
    marker.dataset.workConversation = current.workConversation ? 'true' : 'false'
    marker.style.background = current.workConversation
      ? '#ef4444'
      : current.effectiveEnabled
        ? '#22c55e'
        : 'transparent'
    marker.style.boxShadow = current.workConversation
      ? '0 0 0 1px rgb(239 68 68 / 32%), 0 0 8px rgb(239 68 68 / 55%)'
      : current.effectiveEnabled
        ? '0 0 0 1px rgb(34 197 94 / 25%), 0 0 6px rgb(34 197 94 / 38%)'
        : 'none'
  }

  const renderConversation = () => {
    unmountVue()
    marker?.remove()
    if (shadow) shadow.replaceChildren()
    else host.replaceChildren()
    marker = document.createElement('span')
    marker.setAttribute('aria-hidden', 'true')
    marker.style.cssText =
      'display:block;width:6px;height:6px;flex:0 0 6px;border-radius:999px;background:transparent;'
    ;(shadow ?? host).append(marker)
    updateConversationMarker()
  }

  const renderProject = () => {
    marker?.remove()
    marker = undefined
    unmountVue()
    host.replaceChildren()
    const projectShadow = ensureShadow()
    projectShadow.replaceChildren()
    installBoosterShadowStyles(projectShadow)
    const mountPoint = document.createElement('span')
    projectShadow.append(mountPoint)
    projectModel = reactive({ ...current }) as ScopeArchiveControlModel
    app = createApp(ScopeArchiveControl, { model: projectModel })
    app.mount(mountPoint)
  }

  const render = () => {
    if (current.context.scope === 'conversation') renderConversation()
    else renderProject()
  }

  render()

  return {
    update(next) {
      const previousScope = current.context.scope
      current = next
      if (next.context.scope !== previousScope) {
        render()
        return
      }
      if (next.context.scope === 'conversation') updateConversationMarker()
      else if (projectModel) Object.assign(projectModel, next)
    },
    unmount() {
      unmountVue()
      shadow?.replaceChildren()
      host.replaceChildren()
    },
  }
}
