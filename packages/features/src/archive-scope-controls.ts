import {
  currentConversationId,
  currentProjectId,
  mountArchiveScopeControls,
} from '@chatgpt-booster/chatgpt'
import {
  type BoosterModule,
  type BoosterSettings,
  OPEN_CAPTURE_SETTINGS_EVENT,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { resolveLocale, translate } from '@chatgpt-booster/ui'

export class ArchiveScopeControlsModule implements BoosterModule {
  readonly id = 'archive-scope-controls'
  #controls: ReturnType<typeof mountArchiveScopeControls> | undefined
  #unsubscribe: (() => void) | undefined
  #active = false
  constructor(private settings: SettingsAdapter) {}
  async start() {
    this.#active = true
    const settings = await this.settings.get()
    if (!this.#active) return
    this.#apply(settings)
    this.#unsubscribe = this.settings.subscribe((next) => this.#apply(next))
  }
  stop() {
    this.#active = false
    this.#unsubscribe?.()
    this.#controls?.stop()
    this.#controls = undefined
  }
  #apply(settings: BoosterSettings) {
    if (!this.#active) return
    if (!settings.enabled) {
      this.#controls?.stop()
      this.#controls = undefined
      return
    }
    const options: Parameters<typeof mountArchiveScopeControls>[0] = {
      label: translate(resolveLocale(settings.language), 'dock.capture'),
      visible: (context) =>
        context.scope === 'project'
          ? context.id === currentProjectId() || settings.archive.projects[context.id] !== undefined
          : context.id === currentConversationId() ||
            settings.archive.conversations[context.id] !== undefined,
      onOpen: (context) =>
        window.dispatchEvent(new CustomEvent(OPEN_CAPTURE_SETTINGS_EVENT, { detail: context })),
    }
    if (this.#controls) this.#controls.update(options)
    else this.#controls = mountArchiveScopeControls(options)
  }
}
