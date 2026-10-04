import type { ArchiveCaptureContext, CaptureRuleSource } from '@chatgpt-booster/core'
import { type App, createApp, reactive } from 'vue'
import type { SupportedLocale } from './i18n'
import ScopeArchiveControl from './ScopeArchiveControl.vue'
import styles from './styles.css?inline'

export interface ScopeArchiveControlModel {
  context: ArchiveCaptureContext
  locale: SupportedLocale
  archivedCount: number
  effectiveEnabled: boolean
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

export function mountScopeArchiveControl(
  host: HTMLElement,
  initial: ScopeArchiveControlModel,
): MountedScopeArchiveControl {
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)
  const mountPoint = document.createElement('span')
  shadow.append(mountPoint)
  const model = reactive({ ...initial }) as ScopeArchiveControlModel
  const app: App = createApp(ScopeArchiveControl, { model })
  app.mount(mountPoint)
  return {
    update(next) {
      Object.assign(model, next)
    },
    unmount() {
      app.unmount()
    },
  }
}
