import {
  archiveRecordText,
  currentConversationId,
  currentConversationTitle,
  currentProjectId,
  currentProjectTitle,
  observeChatGptNavigation,
} from '@chatgpt-booster/chatgpt'
import {
  ArchiveExportBlockedError,
  type ArchiveExportOptions,
  type ArchiveExportProgressListener,
  type ArchiveExportReadiness,
  resolveCaptureRule,
  resolveExportPreferences,
  type SettingsAdapter,
  scopedExportPreferenceKey,
} from '@chatgpt-booster/core'
import type {
  ArchiveConversationView,
  ArchiveDataAdapter,
  ArchiveExportPreviewMessage,
} from '@chatgpt-booster/ui'
import { ArchiveCanonicalMigrator } from './archive-canonical-migrator'
import { inspectExistingArchiveForMigration } from './archive-migration-preflight'
import type { ArchiveV4CaptureModule } from './archive-v4-capture'
import { type ArchiveV4OutputFormat, prepareArchiveV4Export } from './archive-v4-export'
import type { ArchiveV4Reader } from './archive-v4-reader'
import type { ArchiveV4Store } from './archive-v4-store'
import { archiveWriteScope } from './archive-v4-write'
import { normalizeConversationMessage } from './conversation-records'
import type { ConversationStateStore } from './conversation-state'

/** New-store adapter. No v3 fallback or migration paths. */
export function createArchiveV4UiAdapter(
  store: ArchiveV4Store,
  capture: ArchiveV4CaptureModule,
  reader: ArchiveV4Reader,
  memory: ConversationStateStore,
  settingsAdapter: SettingsAdapter,
): ArchiveDataAdapter {
  const migrator = new ArchiveCanonicalMigrator(store)
  const account = () => {
    const id = memory.verifiedAccountId()
    if (!id) throw new Error('archive.error.auth')
    return id
  }
  const savedView = (
    source: Awaited<ReturnType<typeof store.getConversation>>,
  ): ArchiveConversationView | undefined =>
    source
      ? {
          conversationId: source.conversationId,
          projectId: source.projectId,
          title: source.title,
          updatedAt: source.lastKnownTime,
          lastSeenAt: source.lastSeenAt,
          archiveState: 'partial',
          branchSourceConversationId: null,
          branchSourceTitle: null,
        }
      : undefined
  const liveView = (id: string): ArchiveConversationView | undefined => {
    const snapshot = memory.header(id)
    return snapshot
      ? {
          conversationId: id,
          projectId: snapshot.projectId,
          title: snapshot.title,
          updatedAt: null,
          lastSeenAt: snapshot.lastObservedAt,
          archiveState: 'partial',
          branchSourceConversationId: null,
          branchSourceTitle: null,
        }
      : undefined
  }
  const preferenceProjectId = async (accountId: string, id: string): Promise<string | null> => {
    const live = currentConversationId() === id ? memory.snapshot(id) : undefined
    if (live?.pages.some((page) => page.accountId === accountId)) return live.projectId
    return (await store.getConversation(accountId, id))?.projectId ?? null
  }
  const view = async (id: string) => {
    if (currentConversationId() === id) {
      const active = liveView(id)
      if (active) return active
    }
    const owner = account()
    const epoch = memory.accountEpoch()
    const saved = await store.getConversation(owner, id)
    if (!saved) {
      const recovered = (await migrator.listConversations(owner)).find(
        (x) => x.conversationId === id,
      )
      if (recovered)
        return {
          conversationId: id,
          projectId: recovered.projectId,
          title: recovered.title,
          updatedAt: null,
          lastSeenAt: recovered.lastSeenAt,
          archiveState: 'partial' as const,
          branchSourceConversationId: null,
          branchSourceTitle: null,
        }
    }
    if (memory.accountEpoch() !== epoch || account() !== owner)
      throw new Error('archive.error.auth')
    return savedView(saved)
  }
  const readiness = async (
    id: string,
    options: ArchiveExportOptions,
    signal?: AbortSignal,
  ): Promise<ArchiveExportReadiness> => {
    const owner = memory.verifiedAccountId()
    const ownerEpoch = memory.accountEpoch()
    const result: ArchiveExportReadiness = {
      scope: 'saved_copy',
      sourceAdapterVersion: store.sourceGate.registered
        ? store.sourceGate.version
        : 'unregistered-version',
      sourceAdapterRegistered: store.sourceGate.registered,
      conversationId: id,
      projectId: null,
      sourceRevision: null,
      selectedTipId: null,
      knownRecordCount: 0,
      linkedPageCount: 0,
      pageContinuity: 'unknown',
      captureCoverage: 'unknown',
      pathVerification: 'unknown',
      latestHeadMatches: null,
      blockers: [],
      collectionBlocker: capture.collectionBlocker(id),
      captureCategories: null,
    }
    const assertActive = () => {
      if (signal?.aborted) throw new DOMException('Export inspection cancelled', 'AbortError')
    }
    assertActive()
    if (!owner) {
      result.blockers.push('account_unverified')
      return result
    }
    if (!store.sourceGate.registered || store.sourceGate.get(id)) {
      result.blockers.push('source_incompatible')
      return result
    }
    try {
      const [evidence, settings] = await Promise.all([
        store.getExportEvidence(owner, id, signal),
        settingsAdapter.get(),
      ])
      assertActive()
      if (memory.verifiedAccountId() !== owner || memory.accountEpoch() !== ownerEpoch)
        throw new Error('archive.error.auth')
      if (store.sourceGate.get(id)) {
        result.blockers.push('source_incompatible')
        result.collectionBlocker = 'source_incompatible'
        return result
      }
      const conversation = evidence.conversation
      const live = currentConversationId() === id ? memory.snapshot(id) : undefined
      const liveOwned = !!live?.pages.some((page) => page.accountId === owner)
      result.projectId = conversation
        ? conversation.projectId
        : liveOwned
          ? (live?.projectId ?? null)
          : null
      result.sourceRevision = conversation?.revision ?? null
      result.sourceInstanceId = conversation?.instanceId ?? null
      result.selectedTipId = conversation?.currentNodeId ?? null
      result.knownRecordCount = conversation?.knownMessageCount ?? 0
      result.linkedPageCount = evidence.pages.pageCount
      result.pageContinuity = evidence.pages.verified
        ? 'verified'
        : evidence.pages.pageCount
          ? 'partial'
          : 'unknown'
      result.captureCoverage = evidence.captureCoverage
      result.pathVerification = evidence.pathVerified
        ? 'verified_checkpoint'
        : conversation?.currentNodeId
          ? 'needs_verification'
          : 'unknown'
      result.latestHeadMatches =
        liveOwned && live?.currentNodeId && result.selectedTipId
          ? live.currentNodeId === result.selectedTipId
          : null
      result.collectionBlocker = capture.collectionBlocker(id)
      const rule = resolveCaptureRule(settings.archive, id, result.projectId).rule
      result.captureCategories = {
        reasoning: rule.reasoning,
        tools: rule.tools,
        internal: rule.internal,
      }
      if (!conversation) result.blockers.push('conversation_missing')
      else {
        if (!conversation.currentNodeId) result.blockers.push('selection_missing')
        if (!evidence.pages.pageCount) result.blockers.push('page_unknown')
        else if (!evidence.pages.verified) result.blockers.push('page_incomplete')
        if (evidence.captureCoverage === 'omitted') result.blockers.push('capture_omissions')
        else if (evidence.captureCoverage === 'unknown' && evidence.pages.pageCount)
          result.blockers.push('capture_unknown')
        if (!evidence.headReadMatches) result.blockers.push('source_changed')
        if (result.latestHeadMatches === false) result.blockers.push('head_mismatch')
      }
    } catch (cause) {
      assertActive()
      result.blockers = [
        memory.verifiedAccountId() !== owner || memory.accountEpoch() !== ownerEpoch
          ? 'account_unverified'
          : cause instanceof Error && cause.message === 'archive.error.sourceChanged'
            ? 'source_changed'
            : 'storage_unavailable',
      ]
      return result
    }
    if (options.level !== 'conversation' && (options.images || options.files))
      result.blockers.push('assets_unverified')
    if (options.level === 'full' && options.format !== 'json' && options.format !== 'json-compact')
      result.blockers.push('technical_requires_json')
    return result
  }
  return {
    getCurrentContext: async () => {
      const epoch = memory.accountEpoch()
      const conversationId = currentConversationId() ?? null
      const active = conversationId ? liveView(conversationId) : undefined
      const conversation = active ?? (conversationId ? await view(conversationId) : undefined)
      const projectId = currentProjectId() ?? conversation?.projectId ?? null
      const observedTitle = projectId ? currentProjectTitle(projectId) : null
      const persisted =
        projectId && !observedTitle ? await store.getProject(account(), projectId) : undefined
      if (epoch !== memory.accountEpoch() || conversationId !== (currentConversationId() ?? null))
        throw new Error('archive.error.auth')
      return {
        conversationId,
        conversationTitle: conversation?.title ?? currentConversationTitle() ?? null,
        projectId,
        projectTitle: observedTitle ?? persisted?.title ?? null,
      }
    },
    currentConversationId: () => currentConversationId() ?? null,
    currentProjectId: () => currentProjectId() ?? null,
    currentAccountId: () => memory.verifiedAccountId(),
    hasIncompatibleSource: (id) => !!store.sourceGate.get(id),
    collectionInsideExportOnly: true,
    getCollectionState: () => capture.collectionSession.snapshot(),
    stopCollection: (request) => capture.stopCollection(request),
    archiveGeneration: 4,
    getArchiveMigrationOverview: async () => {
      const owner = account()
      const [inventory, saved] = await Promise.all([
        inspectExistingArchiveForMigration(owner),
        migrator.listConversations(owner),
      ])
      if (account() !== owner) throw new Error('archive.error.auth')
      return {
        status: migrator.snapshot().status,
        legacyConversations: inventory.sources.reduce(
          (sum, source) =>
            sum +
            source.verifiedOwnerConversations +
            (source.namespace === 'v3'
              ? source.unboundOwnerConversations + source.conflictingOwnerConversations
              : 0),
          0,
        ),
        unboundConversations:
          inventory.sources.find((source) => source.namespace === 'v3')
            ?.unboundOwnerConversations ?? 0,
        conflictingConversations:
          inventory.sources.find((source) => source.namespace === 'v3')
            ?.conflictingOwnerConversations ?? 0,
        migratedConversations: saved.length,
      }
    },
    reconcileArchiveRecent: async (hours, bindUnknownLegacy) => {
      const owner = account()
      const epoch = memory.accountEpoch()
      const report = await migrator.reconcileRecent(
        owner,
        Date.now() - hours * 60 * 60 * 1000,
        bindUnknownLegacy,
        hours === 48,
      )
      if (memory.accountEpoch() !== epoch || account() !== owner)
        throw new Error('archive.error.auth')
      reader.reset()
      return report
    },
    auditArchiveCoverage: async () => {
      const owner = account()
      const epoch = memory.accountEpoch()
      const audit = await migrator.auditCoverage(owner)
      if (memory.accountEpoch() !== epoch || account() !== owner)
        throw new Error('archive.error.auth')
      return audit
    },
    startArchiveMigration: async (bindUnowned) => {
      const owner = account()
      const epoch = memory.accountEpoch()
      await migrator.migrate(owner, bindUnowned)
      if (memory.accountEpoch() !== epoch || account() !== owner)
        throw new Error('archive.error.auth')
      reader.reset()
    },
    subscribeArchiveMigration: (handler) => migrator.subscribe(() => handler()),
    isRecoveredConversation: async (id) => migrator.hasConversation(account(), id),
    archiveMigrationProgress: () => migrator.snapshot(),
    exportRecoveredConversation: async (id, format) => {
      const owner = account()
      if (!(await migrator.hasConversation(owner, id))) return null
      const result = await migrator.exportKnownRecords(owner, id, format)
      if (owner !== account()) throw new Error('archive.error.auth')
      return result
    },
    subscribeContextChange: (handler) => {
      const navigation = observeChatGptNavigation(handler)
      const identity = memory.subscribeAccount(handler)
      return () => {
        navigation()
        identity()
      }
    },
    getExportReadiness: readiness,
    subscribeExportChanges: (id, handler) => {
      const unsubscribe = store.subscribe((change) => {
        if (change.accountId !== memory.verifiedAccountId()) return
        if (
          change.kind === 'cleared' ||
          (change.kind === 'conversation' && change.conversationId === id)
        )
          handler()
      })
      let head = memory.snapshot(id)?.currentNodeId ?? null
      const live = memory.subscribe((change) => {
        if (change.conversationId !== id) return
        const next = memory.snapshot(id)?.currentNodeId ?? null
        if (next !== head) {
          head = next
          handler()
        }
      })
      return () => {
        unsubscribe()
        live()
      }
    },
    listProjects: async () => {
      const owner = account()
      const ownerEpoch = memory.accountEpoch()
      const projects = await store.listProjects(owner)
      if (account() !== owner || memory.accountEpoch() !== ownerEpoch)
        throw new Error('archive.error.auth')
      const byId = new Map(
        projects.map((item) => [item.projectId, { projectId: item.projectId, title: item.title }]),
      )
      for (const snapshot of memory.listSnapshots()) {
        const projectId = snapshot.projectId
        if (projectId)
          byId.set(projectId, {
            projectId,
            title: currentProjectTitle(projectId) ?? byId.get(projectId)?.title ?? null,
          })
      }
      return [...byId.values()]
    },
    getConversation: (id) => view(id),
    getCoverage: async (id, request) => {
      const owner = account()
      if (
        (request?.source === 'saved' || currentConversationId() !== id) &&
        (await migrator.hasConversation(owner, id))
      ) {
        const records = await migrator.readMessages(owner, id)
        return {
          conversationId: id,
          knownMessageCount: records.length,
          visibleMessageCount: records.length,
          internalRecordCount: 0,
          historyPageCount: 0,
          verifiedAt: null,
          hasOlderServerHistory: null,
          completeAtLastRead: false,
          lastFullReadAt: null,
          oldestKnownVisibleMessageId: records[0]?.messageId ?? null,
          newestKnownVisibleMessageId: records.at(-1)?.messageId ?? null,
        }
      }
      if (request?.expectedAccountId !== undefined && request.expectedAccountId !== account())
        throw new Error('archive.error.auth')
      if (request?.signal?.aborted)
        throw new DOMException('Archive coverage cancelled', 'AbortError')
      const live =
        request?.source !== 'saved' && currentConversationId() === id
          ? memory.snapshot(id)
          : undefined
      if (live?.records.length) {
        // Live controls never await an IndexedDB read to obtain their state.
        return {
          conversationId: id,
          knownMessageCount: live.records.length,
          visibleMessageCount: live.records.length,
          internalRecordCount: 0,
          evidenceVersion: 2,
          historyPageCount: live.pages.length,
          verifiedAt: null,
          hasOlderServerHistory: null,
          completeAtLastRead: false,
          lastFullReadAt: null,
        }
      }
      const ownerEpoch = memory.accountEpoch()
      const evidence = await store.getExportEvidence(owner, id, request?.signal)
      if (account() !== owner || memory.accountEpoch() !== ownerEpoch)
        throw new Error('archive.error.auth')
      const stored = evidence.conversation
      if (!stored) return undefined
      if (request?.expectedRevision !== undefined && request.expectedRevision !== stored.revision)
        throw new Error('archive.error.sourceChanged')
      if (
        request?.expectedInstanceId !== undefined &&
        request.expectedInstanceId !== (stored.instanceId ?? null)
      )
        throw new Error('archive.error.sourceChanged')
      const coverage = evidence.pages
      const count = stored.knownMessageCount
      const selectedPathVerified = evidence.pathVerified
      return {
        conversationId: id,
        knownMessageCount: count,
        visibleMessageCount: count,
        internalRecordCount: 0,
        evidenceVersion: 2,
        historyPageCount: coverage.pageCount,
        verifiedAt: coverage.verified ? coverage.observedAt : null,
        hasOlderServerHistory: coverage.pageCount ? !coverage.startReached : null,
        // Native pagination alone is never sufficient: the selected path must
        // have been verified against this exact persisted source revision.
        completeAtLastRead: selectedPathVerified,
        lastFullReadAt: null,
        oldestKnownVisibleMessageId: stored?.firstKnownMessageId ?? null,
        newestKnownVisibleMessageId: stored?.lastKnownMessageId ?? null,
      }
    },
    listConversations: async () => {
      const owner = account()
      const ownerEpoch = memory.accountEpoch()
      const [stored, imported] = await Promise.all([
        store.listConversations(owner),
        migrator.listConversations(owner),
      ])
      if (account() !== owner || memory.accountEpoch() !== ownerEpoch)
        throw new Error('archive.error.auth')
      const byId = new Map<string, ArchiveConversationView>()
      for (const item of stored) {
        const candidate = savedView(item)
        if (candidate) byId.set(item.conversationId, candidate)
      }
      for (const item of imported)
        byId.set(item.conversationId, {
          conversationId: item.conversationId,
          projectId: item.projectId,
          title: item.title,
          lastSeenAt: item.lastSeenAt,
          updatedAt: null,
          archiveState: 'partial',
          branchSourceConversationId: null,
          branchSourceTitle: null,
        })
      const activeId = currentConversationId()
      if (activeId) {
        const current = liveView(activeId)
        if (current) byId.set(activeId, current)
      }
      return [...byId.values()].sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    },
    getExportPreferences: async (id, scope = 'conversation') => {
      const owner = account()
      const ownerEpoch = memory.accountEpoch()
      const [settings, projectId] = await Promise.all([
        settingsAdapter.get(),
        preferenceProjectId(owner, id),
      ])
      if (account() !== owner || memory.accountEpoch() !== ownerEpoch)
        throw new Error('archive.error.auth')
      const overrides =
        scope === 'global'
          ? { projects: {}, conversations: {} }
          : scope === 'project'
            ? { projects: settings.exportOverrides.projects, conversations: {} }
            : settings.exportOverrides
      const effective = resolveExportPreferences(settings.export, overrides, owner, projectId, id)
      return { ...effective, projectId, accountId: owner }
    },
    saveExportPreferences: async (id, scope, options, context) => {
      const owner = account()
      const ownerEpoch = memory.accountEpoch()
      if (context.accountId !== owner) throw new Error('archive.error.auth')
      const projectId = await preferenceProjectId(owner, id)
      if (
        account() !== owner ||
        memory.accountEpoch() !== ownerEpoch ||
        context.projectId !== projectId
      )
        throw new Error('archive.error.auth')
      if (scope === 'global') {
        if (!options) throw new Error('archive.error.invalidExportPreference')
        await settingsAdapter.update({ export: options })
        return
      }
      const key = scopedExportPreferenceKey(owner, scope === 'project' ? (projectId ?? '') : id)
      const patch =
        scope === 'project'
          ? { projects: { [key]: options } }
          : { conversations: { [key]: options } }
      await settingsAdapter.update({ exportOverrides: patch })
    },
    getExportPreview: async (id) => {
      store.sourceGate.assertCompatible(id)
      const owner = account()
      const ownerEpoch = memory.accountEpoch()
      const [preview, evidence] = await Promise.all([
        store.readPreview(owner, id, 3),
        store.getExportEvidence(owner, id),
      ])
      if (
        preview.conversation?.revision !== evidence.conversation?.revision ||
        preview.conversation?.currentNodeId !== evidence.conversation?.currentNodeId ||
        (preview.conversation?.instanceId ?? null) !== (evidence.conversation?.instanceId ?? null)
      )
        throw new Error('archive.error.sourceChanged')
      const { pages, captureCoverage } = evidence
      if (account() !== owner || memory.accountEpoch() !== ownerEpoch)
        throw new Error('archive.error.auth')
      store.sourceGate.assertCompatible(id)
      const mapPreview = (records: typeof preview.earliest): ArchiveExportPreviewMessage[] =>
        records.map((message) => {
          const normalized = normalizeConversationMessage(
            message.raw,
            id,
            preview.conversation?.projectId ?? null,
            message.lastSeenAt,
          )
          if (!normalized) throw new Error('archive.error.incompatibleSource')
          return {
            ...(preview.conversation
              ? {
                  location: {
                    accountId: owner,
                    conversationId: id,
                    messageId: message.messageId,
                    source: 'saved' as const,
                    sourceRevision: preview.conversation.revision,
                    sourceInstanceId: preview.conversation.instanceId ?? null,
                  },
                }
              : {}),
            messageId: message.messageId,
            role: normalized.role,
            text: archiveRecordText(normalized).slice(0, 280),
          }
        })
      const live = currentConversationId() === id ? memory.snapshot(id) : undefined
      const selectedTipId = preview.conversation?.currentNodeId ?? null
      return {
        earliest: mapPreview(preview.earliest),
        latest: mapPreview(preview.latest),
        hiddenKnownCount: preview.hiddenKnownCount,
        knownCount: preview.conversation?.knownMessageCount ?? 0,
        hasUnsequencedMessages: preview.hasUnsequencedMessages,
        selectedTipId,
        sourcePageContinuity: pages.verified ? 'verified' : pages.pageCount ? 'partial' : 'unknown',
        captureCoverage,
        latestHeadMatches:
          live?.currentNodeId && selectedTipId ? live.currentNodeId === selectedTipId : null,
      }
    },
    getThreadWindow: async (id, cursor, direction, request) => {
      const owner = account()
      if (
        (request?.source === 'saved' || currentConversationId() !== id) &&
        (await migrator.hasConversation(owner, id))
      )
        return migrator.threadWindow(
          owner,
          id,
          cursor ?? null,
          direction ?? 'older',
          request?.signal,
        )
      return reader.readThreadWindow(owner, id, cursor, 40, direction, request)
    },
    getMessageWindow: async (id, messageId, request) => {
      const owner = account()
      if (
        (request?.source === 'saved' || currentConversationId() !== id) &&
        (await migrator.hasConversation(owner, id))
      )
        return migrator.threadWindow(owner, id, null, 'older', request?.signal, messageId)
      return reader.readMessageWindow(owner, id, messageId, request)
    },
    getThread: async (id) => {
      const owner = account()
      if (currentConversationId() !== id && (await migrator.hasConversation(owner, id)))
        return (await migrator.threadWindow(owner, id)).thread
      return (await reader.readThreadWindow(owner, id)).thread
    },
    listMessages: async (id) => {
      const owner = account()
      const thread = (
        await (currentConversationId() !== id && (await migrator.hasConversation(owner, id))
          ? migrator.threadWindow(owner, id)
          : reader.readThreadWindow(owner, id))
      ).thread
      return thread.turns.flatMap((turn) =>
        [...turn.messages, ...turn.details].map((item) => item.record),
      )
    },
    collectCurrent: () => capture.collectCurrent(),
    clearAll: async () => {
      await capture.clearSavedAccount(account())
      reader.reset()
    },
    listExportFormats: () => [
      {
        id: 'json',
        label: 'JSON · readable',
        mimeType: 'application/json',
        fileExtension: 'json',
        isDefault: true,
      },
      {
        id: 'json-compact',
        label: 'JSON · compact',
        mimeType: 'application/json',
        fileExtension: 'json',
        isDefault: false,
      },
      {
        id: 'markdown',
        label: 'Markdown',
        mimeType: 'text/markdown',
        fileExtension: 'md',
        isDefault: false,
      },
      { id: 'text', label: 'Text', mimeType: 'text/plain', fileExtension: 'txt', isDefault: false },
    ],
    exportConversation: async (
      id: string,
      options: ArchiveExportOptions,
      signal?: AbortSignal,
      onProgress?: ArchiveExportProgressListener,
    ) => {
      const owner = account()
      const ownerEpoch = memory.accountEpoch()
      const initialRoute = currentConversationId() ?? null
      const initialHead = initialRoute === id ? (memory.header(id)?.currentNodeId ?? null) : null
      const stillAuthorized = () =>
        memory.verifiedAccountId() === owner &&
        memory.accountEpoch() === ownerEpoch &&
        (currentConversationId() ?? null) === initialRoute &&
        (initialRoute !== id ||
          initialHead === null ||
          memory.header(id)?.currentNodeId === initialHead)
      const contextAbort = new AbortController()
      const revoke = () =>
        contextAbort.abort(new DOMException('Export context changed', 'AbortError'))
      const offAccount = memory.subscribeAccount(revoke)
      const offRoute = observeChatGptNavigation(() => {
        if (!stillAuthorized()) revoke()
      })
      const offLive = memory.subscribe((change) => {
        if (change.conversationId === id && (change.reason === 'request' || !stillAuthorized()))
          revoke()
      })
      const offStore = store.subscribe((change) => {
        if (change.accountId === owner && change.kind === 'cleared') revoke()
      })
      const scoped = archiveWriteScope([signal, contextAbort.signal])
      try {
        const conversation = await store.getConversation(owner, id)
        if (!stillAuthorized()) throw new Error('archive.error.auth')
        if (!conversation) throw new ArchiveExportBlockedError('conversation_missing')
        if (!conversation.currentNodeId) throw new ArchiveExportBlockedError('selection_missing')
        if (initialHead && initialHead !== conversation.currentNodeId)
          throw new ArchiveExportBlockedError('head_mismatch')
        const format: ArchiveV4OutputFormat =
          options.format === 'json'
            ? 'json-readable'
            : options.format === 'json-compact' ||
                options.format === 'markdown' ||
                options.format === 'text'
              ? options.format
              : 'json-readable'
        if (options.images || options.files)
          throw new ArchiveExportBlockedError('assets_unverified')
        return await prepareArchiveV4Export(store, {
          accountId: owner,
          conversationId: id,
          selectedTipId: conversation.currentNodeId,
          mode:
            options.level === 'full'
              ? 'technical'
              : options.level === 'custom'
                ? 'selective'
                : 'basic',
          format,
          packaging: options.packaging ?? 'none',
          reasoning: options.reasoning,
          tools: options.tools,
          internal: options.internal,
          ...(options.reasoningRecap === undefined
            ? {}
            : { reasoningRecap: options.reasoningRecap }),
          ...(options.reasoningFull === undefined ? {} : { reasoningFull: options.reasoningFull }),
          ...(options.toolCalls === undefined ? {} : { toolCalls: options.toolCalls }),
          ...(options.toolResults === undefined ? {} : { toolResults: options.toolResults }),
          ...(options.toolSourceContent === undefined
            ? {}
            : { toolSourceContent: options.toolSourceContent }),
          ...(options.modelEvidence === undefined ? {} : { modelEvidence: options.modelEvidence }),
          ...(options.dictationEditEvidence === undefined
            ? {}
            : { dictationEditEvidence: options.dictationEditEvidence }),
          ...(options.sourceRevisions === undefined
            ? {}
            : { sourceRevisions: options.sourceRevisions }),
          ...(options.attachmentMetadata === undefined
            ? {}
            : { attachmentMetadata: options.attachmentMetadata }),
          stillAuthorized,
          ...(onProgress ? { onProgress } : {}),
          signal: scoped.signal,
        })
      } finally {
        offAccount()
        offRoute()
        offLive()
        offStore()
        scoped.close()
      }
    },
  }
}
