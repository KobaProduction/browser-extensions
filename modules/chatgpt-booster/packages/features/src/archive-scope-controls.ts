import {
  currentConversationId,
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
  OPEN_ARCHIVE_EVENT,
  OPEN_CAPTURE_SETTINGS_EVENT,
  resolveCaptureRule,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  mountScopeArchiveControl,
  resolveLocale,
  type ScopeArchiveControlModel,
} from '@chatgpt-booster/ui'
import { type SourceScopeConversation, sourceScopeContext } from './archive-scope-context'
import type { ConversationStateStore } from './conversation-state'

interface ArchiveScopeListing {
  listConversations(): Promise<SourceScopeConversation[]>
  listProjects(): Promise<{ projectId: string; title: string | null }[]>
}

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
  #accountUnsubscribe: (() => void) | undefined
  #catalogUnsubscribe: (() => void) | undefined
  #active = false
  #latestSettings: BoosterSettings | undefined
  #conversationProjects = new Map<string, string | null>()
  #archivedConversationIds = new Set<string>()
  #projectArchivedCounts = new Map<string, number>()
  #sourceProjects = new Map<string, { projectId: string; title: string | null }>()
  #sourceConversations = new Map<string, SourceScopeConversation>()
  #archiveOwner: string | null = null
  #archiveEpoch = -1
  #archiveStateRefresh: Promise<void> | undefined
  #archiveStateRefreshQueued = false
  #initialTask: ScheduledIdleTask | undefined

  constructor(
    private settings: SettingsAdapter,
    private store?: ArchiveScopeListing,
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
    this.#catalogUnsubscribe = this.stateStore?.subscribeCatalog((detail) => {
      if (this.#active && this.#latestSettings?.enabled && detail.projects) this.#apply()
    })
    this.#accountUnsubscribe = this.stateStore?.subscribeAccount(() => {
      this.#sourceProjects.clear()
      this.#sourceConversations.clear()
      this.#conversationProjects.clear()
      this.#archivedConversationIds.clear()
      this.#projectArchivedCounts.clear()
      this.#archiveOwner = null
      this.#archiveEpoch = -1
      this.#apply()
      if (this.#latestSettings?.enabled)
        void this.#refreshArchiveState().then(() => {
          if (this.#active) this.#apply()
        })
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
    this.#accountUnsubscribe?.()
    this.#accountUnsubscribe = undefined
    this.#catalogUnsubscribe?.()
    this.#catalogUnsubscribe = undefined
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
    const owner = this.stateStore?.verifiedAccountId(),
      epoch = this.stateStore?.accountEpoch()
    if (!owner) return
    try {
      const [conversations, projects] = await Promise.all([
        this.store.listConversations(),
        this.store.listProjects(),
      ])
      if (
        !this.#active ||
        this.stateStore?.verifiedAccountId() !== owner ||
        this.stateStore.accountEpoch() !== epoch
      )
        return
      this.#archiveOwner = owner
      this.#archiveEpoch = epoch ?? -1
      this.#sourceConversations = new Map(conversations.map((value) => [value.conversationId, value]))
      this.#sourceProjects = new Map(projects.map((value) => [value.projectId, value]))
      this.#conversationProjects = new Map(
        conversations.map((conversation) => [conversation.conversationId, conversation.projectId]),
      )
      this.#archivedConversationIds = new Set(
        conversations.map((conversation) => conversation.conversationId),
      )
      const projectCounts = new Map<string, number>()
      for (const conversation of conversations) {
        if (!conversation.projectId) continue
        projectCounts.set(conversation.projectId, (projectCounts.get(conversation.projectId) ?? 0) + 1)
      }
      this.#projectArchivedCounts = projectCounts
    } catch {
      // Sidebar controls stay usable if local archive state is temporarily unavailable.
    }
  }

  #projectId(context: ArchiveCaptureContext) {
    if (context.scope === 'project') return context.id
    const source = this.#sourceContext(context)
    return source?.scope === 'conversation' ? (source.projectId ?? null) : null
  }

  #sourceContext(context: ArchiveCaptureContext) {
    const owner = this.stateStore?.verifiedAccountId() ?? null
    const cached = owner === this.#archiveOwner && this.stateStore?.accountEpoch() === this.#archiveEpoch
    return sourceScopeContext(context, {
      ownerId: owner,
      nativeConversation: (id) => this.stateStore?.header(id),
      savedConversation: (id) => (cached ? this.#sourceConversations.get(id) : undefined),
      savedProject: (id) =>
        (owner ? this.stateStore?.project(id) : undefined) ??
        (cached ? this.#sourceProjects.get(id) : undefined),
      currentNativeProjectId: owner
        ? (this.stateStore?.header(currentConversationId() ?? '')?.projectId ?? null)
        : null,
    })
  }

  #model(context: ArchiveCaptureContext): ScopeArchiveControlModel {
    const settings = this.#latestSettings
    if (!settings) throw new Error('Archive scope settings unavailable')
    const confirmed = this.#sourceContext(context)
    if (!confirmed) throw Error('Verified archive scope unavailable')
    context = confirmed
    const owner = this.stateStore?.verifiedAccountId(),
      epoch = this.stateStore?.accountEpoch()
    const actionContext = () => {
      if (
        !owner ||
        this.stateStore?.verifiedAccountId() !== owner ||
        this.stateStore.accountEpoch() !== epoch
      )
        throw Error('Archive scope owner changed')
      const next = this.#sourceContext(context)
      if (!next) throw Error('Verified archive scope unavailable')
      return next
    }
    const projectId = this.#projectId(context)
    const resolved =
      context.scope === 'project'
        ? {
            rule: settings.archive.projects[context.id] ?? settings.archive.defaultRule,
            source: settings.archive.projects[context.id] ? ('project' as const) : ('default' as const),
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
      onSetEnabled: (enabled) => this.#setEnabled(actionContext(), enabled),
      onInherit: () => this.#inherit(actionContext()),
      onSettings: () => this.#openSettings(actionContext()),
      onOpenArchive: () => {
        const context = actionContext()
        window.dispatchEvent(new CustomEvent(OPEN_ARCHIVE_EVENT, { detail: context }))
      },
    }
  }

  async #setEnabled(context: ArchiveCaptureContext, enabled: boolean) {
    const settings = this.#latestSettings ?? (await this.settings.get())
    const confirmed = this.#sourceContext(context)
    if (!confirmed) throw Error('Verified archive scope unavailable')
    context = confirmed
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
      visible: (context) => this.#sourceContext(context) !== undefined,
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
