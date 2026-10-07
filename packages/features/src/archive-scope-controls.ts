import {
  currentConversationId,
  currentProjectId,
  isChatGptWorkConversationOrigin,
  mountArchiveScopeControls,
  type ScheduledIdleTask,
  scheduleIdleTask,
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
import {
  mountScopeArchiveControl,
  resolveLocale,
  type ScopeArchiveControlModel,
} from '@chatgpt-booster/ui'
import type { ConversationArchiveStore } from './archive-store'
import type { ConversationStateStore } from './conversation-state'

function sameCaptureRule(
  a: BoosterSettings['archive']['defaultRule'],
  b: BoosterSettings['archive']['defaultRule'],
) {
  return (
    a.enabled === b.enabled &&
    a.reasoning === b.reasoning &&
    a.tools === b.tools &&
    a.internal === b.internal
  )
}

function sameCaptureRuleMap(
  a: BoosterSettings['archive']['projects'],
  b: BoosterSettings['archive']['projects'],
) {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => {
    const left = a[key]
    const right = b[key]
    return !!left && !!right && sameCaptureRule(left, right)
  })
}

function scopeSettingsChanged(previous: BoosterSettings | undefined, next: BoosterSettings) {
  if (!previous) return true
  return (
    previous.enabled !== next.enabled ||
    previous.language !== next.language ||
    !sameCaptureRule(previous.archive.defaultRule, next.archive.defaultRule) ||
    !sameCaptureRuleMap(previous.archive.projects, next.archive.projects) ||
    !sameCaptureRuleMap(previous.archive.conversations, next.archive.conversations)
  )
}

export class ArchiveScopeControlsModule implements BoosterModule {
  readonly id = 'archive-scope-controls'
  #controls: ReturnType<typeof mountArchiveScopeControls> | undefined
  #unsubscribe: (() => void) | undefined
  #stateUnsubscribe: (() => void) | undefined
  #active = false
  #latestSettings: BoosterSettings | undefined
  #conversationProjects = new Map<string, string | null>()
  #archivedConversationIds = new Set<string>()
  #projectArchivedCounts = new Map<string, number>()
  #projectIdsByTitle = new Map<string, string>()
  #archiveStateRefresh: Promise<void> | undefined
  #archiveStateRefreshQueued = false
  #initialTask: ScheduledIdleTask | undefined

  constructor(
    private settings: SettingsAdapter,
    private store?: Pick<ConversationArchiveStore, 'listConversations' | 'listProjects'>,
    private stateStore?: ConversationStateStore,
  ) {}

  async start() {
    this.#active = true
    const settings = await this.settings.get()
    if (!this.#active) return
    this.#latestSettings = settings
    this.#unsubscribe = this.settings.subscribe((next) => {
      const previous = this.#latestSettings
      const changed = scopeSettingsChanged(previous, next)
      const enabledChanged = next.enabled !== previous?.enabled
      this.#latestSettings = next
      if (!changed) return
      if (!next.enabled) {
        this.#apply()
        return
      }
      if (enabledChanged) {
        void this.#refreshArchiveState().then(() => {
          if (this.#active && this.#latestSettings?.enabled) this.#apply()
        })
        return
      }
      this.#apply()
    })
    window.addEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    this.#stateUnsubscribe = this.stateStore?.subscribe((change) => {
      if (
        this.#active &&
        this.#latestSettings?.enabled &&
        (change.reason === 'catalog' || change.reason === 'request' || change.reason === 'page')
      )
        this.#apply()
    })
    if (settings.enabled) {
      this.#initialTask = scheduleIdleTask(() => {
        this.#initialTask = undefined
        if (!this.#active || !this.#latestSettings?.enabled) return
        void this.#refreshArchiveState().then(() => {
          if (this.#active && this.#latestSettings?.enabled) this.#apply()
        })
      }, 350)
    }
  }

  stop() {
    this.#active = false
    this.#initialTask?.cancel()
    this.#initialTask = undefined
    this.#unsubscribe?.()
    this.#stateUnsubscribe?.()
    this.#stateUnsubscribe = undefined
    window.removeEventListener(ARCHIVE_UPDATED_EVENT, this.#onArchiveUpdated)
    this.#controls?.stop()
    this.#controls = undefined
  }

  #onArchiveUpdated = (event: Event) => {
    if (!this.#latestSettings?.enabled) return
    const detail = (
      event as CustomEvent<{
        conversationId?: string
        projectId?: string | null
        preload?: boolean
      }>
    ).detail

    // Preload pages are transient and cannot change sidebar archive markers. Once a
    // conversation is already known with the same project relation, later history pages
    // also leave the scope-control model unchanged. Avoid rereading the whole archive and
    // rescanning sidebar DOM for those high-frequency events.
    if (detail?.preload) return
    if (detail?.conversationId && this.#archivedConversationIds.has(detail.conversationId)) {
      const knownProject = this.#conversationProjects.get(detail.conversationId) ?? null
      const nextProject = detail.projectId ?? knownProject
      if (knownProject === nextProject) return
    }

    void this.#refreshArchiveState().then(() => {
      if (this.#active) this.#apply()
    })
  }

  async #refreshArchiveState() {
    if (!this.store) return
    if (this.#archiveStateRefresh) {
      this.#archiveStateRefreshQueued = true
      return await this.#archiveStateRefresh
    }

    const pending = (async () => {
      do {
        this.#archiveStateRefreshQueued = false
        await this.#loadArchiveState()
      } while (this.#archiveStateRefreshQueued && this.#active)
    })()
    this.#archiveStateRefresh = pending
    try {
      await pending
    } finally {
      if (this.#archiveStateRefresh === pending) this.#archiveStateRefresh = undefined
    }
  }

  async #loadArchiveState() {
    if (!this.store) return
    try {
      const [conversations, projects] = await Promise.all([
        this.store.listConversations(),
        this.store.listProjects(),
      ])
      if (!this.#active) return
      this.#conversationProjects = new Map(
        conversations.map((conversation) => [conversation.conversationId, conversation.projectId]),
      )
      this.#archivedConversationIds = new Set(
        conversations.map((conversation) => conversation.conversationId),
      )
      const projectCounts = new Map<string, number>()
      for (const conversation of conversations) {
        if (!conversation.projectId) continue
        projectCounts.set(
          conversation.projectId,
          (projectCounts.get(conversation.projectId) ?? 0) + 1,
        )
      }
      this.#projectArchivedCounts = projectCounts
      this.#projectIdsByTitle = new Map(
        projects.flatMap((project) => {
          const title = project.title?.trim()
          return title ? [[title.toLocaleLowerCase(), project.projectId] as const] : []
        }),
      )
    } catch {
      // Sidebar controls stay usable if local archive state is temporarily unavailable.
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

  #model(context: ArchiveCaptureContext): ScopeArchiveControlModel {
    const settings = this.#latestSettings
    if (!settings) throw new Error('Archive scope settings unavailable')
    const projectId = this.#projectId(context)
    const resolved =
      context.scope === 'project'
        ? {
            rule: settings.archive.projects[context.id] ?? settings.archive.defaultRule,
            source: settings.archive.projects[context.id]
              ? ('project' as const)
              : ('default' as const),
          }
        : resolveCaptureRule(settings.archive, context.id, projectId)
    const hasOverride =
      context.scope === 'project'
        ? settings.archive.projects[context.id] !== undefined
        : settings.archive.conversations[context.id] !== undefined

    return {
      context: context.scope === 'conversation' ? { ...context, projectId } : context,
      locale: resolveLocale(settings.language),
      archivedCount:
        context.scope === 'project'
          ? (this.#projectArchivedCounts.get(context.id) ?? 0)
          : this.#archivedConversationIds.has(context.id)
            ? 1
            : 0,
      effectiveEnabled: settings.enabled && resolved.rule.enabled,
      workConversation:
        context.scope === 'conversation' &&
        isChatGptWorkConversationOrigin(this.stateStore?.conversationOrigin(context.id)),
      source: resolved.source,
      hasOverride,
      onSetEnabled: (enabled) => this.#setEnabled(context, enabled),
      onInherit: () => this.#inherit(context),
      onSettings: () => this.#openSettings(context),
    }
  }

  async #setEnabled(context: ArchiveCaptureContext, enabled: boolean) {
    const settings = this.#latestSettings ?? (await this.settings.get())
    const projectId = this.#projectId(context)
    if (context.scope === 'project') {
      const base = settings.archive.projects[context.id] ?? settings.archive.defaultRule
      await this.settings.update({
        archive: { projects: { [context.id]: { ...base, enabled } } },
      })
      return
    }
    const base = resolveCaptureRule(settings.archive, context.id, projectId).rule
    await this.settings.update({
      archive: { conversations: { [context.id]: { ...base, enabled } } },
    })
  }

  async #inherit(context: ArchiveCaptureContext) {
    if (context.scope === 'project')
      await this.settings.update({ archive: { projects: { [context.id]: null } } })
    else await this.settings.update({ archive: { conversations: { [context.id]: null } } })
  }

  #openSettings(context: ArchiveCaptureContext) {
    window.dispatchEvent(
      new CustomEvent(OPEN_CAPTURE_SETTINGS_EVENT, {
        detail:
          context.scope === 'conversation'
            ? { ...context, projectId: this.#projectId(context) }
            : context,
      }),
    )
  }

  #apply() {
    if (!this.#active) return
    const settings = this.#latestSettings
    if (!settings?.enabled) {
      this.#controls?.stop()
      this.#controls = undefined
      return
    }

    const options: Parameters<typeof mountArchiveScopeControls>[0] = {
      visible: () => true,
      resolveProjectContext: (title) => {
        const id = this.#projectIdsByTitle.get(title.trim().toLocaleLowerCase())
        return id ? { scope: 'project', id, title } : undefined
      },
      mount: (host, context) => {
        const mounted = mountScopeArchiveControl(host, this.#model(context))
        return {
          update: (next) => mounted.update(this.#model(next)),
          unmount: () => mounted.unmount(),
        }
      },
    }

    if (this.#controls) this.#controls.update(options)
    else this.#controls = mountArchiveScopeControls(options)
  }
}
