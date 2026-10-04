import {
  currentConversationId,
  currentProjectId,
  mountArchiveScopeControls,
} from '@chatgpt-booster/chatgpt'
import {
  ARCHIVE_UPDATED_EVENT,
  type ArchiveCaptureContext,
  type BoosterModule,
  type BoosterSettings,
  OPEN_CAPTURE_SETTINGS_EVENT,
  resolveCaptureRule,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { resolveLocale, translate } from '@chatgpt-booster/ui'
import type { ConversationArchiveStore } from './archive-store'

export class ArchiveScopeControlsModule implements BoosterModule {
  readonly id = 'archive-scope-controls'
  #controls: ReturnType<typeof mountArchiveScopeControls> | undefined
  #unsubscribe: (() => void) | undefined
  #active = false
  #latestSettings: BoosterSettings | undefined
  #conversationProjects = new Map<string, string | null>()

  constructor(
    private settings: SettingsAdapter,
    private store?: Pick<ConversationArchiveStore, 'listConversations'>,
  ) {}

  async start() {
    this.#active = true
    const [settings] = await Promise.all([this.settings.get(), this.#refreshConversationProjects()])
    if (!this.#active) return
    this.#latestSettings = settings
    this.#apply(settings)
    this.#unsubscribe = this.settings.subscribe((next) => {
      this.#latestSettings = next
      this.#apply(next)
    })
    window.addEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
  }

  stop() {
    this.#active = false
    this.#unsubscribe?.()
    window.removeEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    this.#controls?.stop()
    this.#controls = undefined
  }

  #onArchiveUpdated = () => {
    void this.#refreshConversationProjects().then(() => {
      if (this.#active && this.#latestSettings) this.#apply(this.#latestSettings)
    })
  }

  async #refreshConversationProjects() {
    if (!this.store) return
    try {
      const conversations = await this.store.listConversations()
      if (!this.#active && this.#latestSettings) return
      this.#conversationProjects = new Map(
        conversations.map((conversation) => [conversation.conversationId, conversation.projectId]),
      )
    } catch {
      // Sidebar controls remain usable; unknown project membership falls back to the default rule.
    }
  }

  #projectId(context: ArchiveCaptureContext) {
    if (context.scope === 'project') return context.id
    return (
      context.projectId ??
      this.#conversationProjects.get(context.id) ??
      (context.id === currentConversationId() ? (currentProjectId() ?? null) : null)
    )
  }

  #apply(settings: BoosterSettings) {
    if (!this.#active) return
    if (!settings.enabled) {
      this.#controls?.stop()
      this.#controls = undefined
      return
    }
    const locale = resolveLocale(settings.language)
    const effective = (context: ArchiveCaptureContext) => {
      if (context.scope === 'project') {
        const rule = settings.archive.projects[context.id] ?? settings.archive.defaultRule
        return settings.enabled && rule.enabled
      }
      return (
        settings.enabled &&
        resolveCaptureRule(settings.archive, context.id, this.#projectId(context)).rule.enabled
      )
    }
    const options: Parameters<typeof mountArchiveScopeControls>[0] = {
      label: (context) =>
        `${translate(
          locale,
          context.scope === 'project' ? 'capture.project' : 'capture.conversation',
        )}: ${
          context.title ||
          translate(
            locale,
            context.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled',
          )
        } · ${translate(locale, effective(context) ? 'dock.autoOn' : 'dock.autoOff')}`,
      enabled: effective,
      visible: (context) =>
        context.scope === 'project' ||
        context.id === currentConversationId() ||
        settings.archive.conversations[context.id] !== undefined,
      onOpen: (context) =>
        window.dispatchEvent(
          new CustomEvent(OPEN_CAPTURE_SETTINGS_EVENT, {
            detail:
              context.scope === 'conversation'
                ? { ...context, projectId: this.#projectId(context) }
                : context,
          }),
        ),
    }
    if (this.#controls) this.#controls.update(options)
    else this.#controls = mountArchiveScopeControls(options)
  }
}
