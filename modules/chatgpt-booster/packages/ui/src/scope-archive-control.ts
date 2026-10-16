import type { ArchiveCaptureContext, CaptureRuleSource } from '@chatgpt-booster/core'
import { UI_PORTAL_TARGET } from '@kobaproduction/browser-ui'
import { createApp, reactive } from 'vue'
import type { SupportedLocale } from './i18n'
import ScopeArchiveControl from './ScopeArchiveControl.vue'
import { createBoosterShadowSurface } from './shadow-styles'

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
  onOpenArchive(): void
}

export interface MountedScopeArchiveControl {
  update(model: ScopeArchiveControlModel): void
  unmount(): void
}

export function mountScopeArchiveControl(
  host: HTMLElement,
  initial: ScopeArchiveControlModel,
): MountedScopeArchiveControl {
  const { shadow, mountPoint, portal } = createBoosterShadowSurface(host)
  const model = reactive({ ...initial }) as ScopeArchiveControlModel
  const app = createApp(ScopeArchiveControl, { model })
  app.provide(UI_PORTAL_TARGET, portal)
  app.mount(mountPoint)
  return {
    update(next) {
      Object.assign(model, next)
    },
    unmount() {
      app.unmount()
      shadow.replaceChildren()
    },
  }
}
