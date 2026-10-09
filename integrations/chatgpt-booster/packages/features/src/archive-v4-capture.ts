import {
  archiveRecordKind,
  asRecord,
  currentConversationId,
  currentProjectTitle,
  hasConversationDraft,
  hasPendingComposerAttachments,
  isConversationGenerating,
  observeChatGptNavigation,
} from '@chatgpt-booster/chatgpt'
import {
  ARCHIVE_SOURCE_INCOMPATIBLE_EVENT,
  ARCHIVE_UPDATED_EVENT,
  type ArchiveCollectionBlocker,
  type BoosterModule,
  type BoosterSettings,
  type CaptureRule,
  captureRuleForOperation,
  HISTORY_LOADER_STOP_EVENT,
  type HistoryLoaderStopRequest,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  ARCHIVE_POLICY_EVENT,
  type ConversationArchiveEventDetail,
  type ConversationCatalogEventDetail,
  TRANSPORT_CHANNEL,
} from '@chatgpt-booster/observer'
import type { ArchiveCollectionRun, ArchiveCollectionSession } from './archive-collection-session'
import { ArchiveContractError, type ArchiveSubmissionSnapshot } from './archive-source-contract'
import type { ArchiveV4Store, ArchiveV4WriteTicket } from './archive-v4-store'
import { ArchiveSourceWriteRegistry, archiveWriteScope } from './archive-v4-write'
import { normalizeConversationProjectId } from './conversation-records'
import type { ConversationStateStore } from './conversation-state'

function retainRawSource(raw: Readonly<Record<string, unknown>>, rule: CaptureRule): boolean {
  const author = asRecord(raw.author)
  const content = asRecord(raw.content)
  const metadata = asRecord(raw.metadata)
  const kind = archiveRecordKind({
    raw,
    role: author?.role ?? null,
    recipient: raw.recipient ?? null,
    channel: raw.channel ?? null,
    contentType: content?.content_type ?? null,
    messageType: metadata?.message_type ?? null,
  } as Parameters<typeof archiveRecordKind>[0])
  if (kind === 'user' || kind === 'answer') return true
  if (kind === 'reasoning') return rule.reasoning
  if (kind === 'tool_call' || kind === 'tool_result') return rule.tools
  return rule.internal
}

interface CapturedPageWork {
  page: ConversationArchiveEventDetail
  accountId: string
  projectId: string | null
  epoch: number
  rule: CaptureRule
  run: ArchiveCollectionRun | undefined
  signal: AbortSignal
  selections: ReadonlyMap<string, ArchiveSubmissionSnapshot>
}

/** Capture runs asynchronously behind RAM; manual permission comes only from the local session service. */
export class ArchiveV4CaptureModule implements BoosterModule {
  readonly id = 'conversation-archive-v4'
  #active = false
  #settings: BoosterSettings = normalizeSettings()
  #catalogUnsubscribe: (() => void) | undefined
  #pageUnsubscribe: (() => void) | undefined
  #settingsUnsubscribe: (() => void) | undefined
  #pending: Promise<void> = Promise.resolve()
  #epoch = 0
  #lifecycleEpoch = 0
  #settingsVersion = 0
  #writes = new AbortController()
  readonly #sourceWrites = new ArchiveSourceWriteRegistry()
  #clearing = false
  #clearOperation: Promise<void> | undefined
  #storeUnsubscribe: (() => void) | undefined
  #pendingByRun = new Map<ArchiveCollectionRun, Set<Promise<void>>>()
  #policySignature = ''
  #ticketTimer: ReturnType<typeof setTimeout> | undefined
  #sessionUnsubscribe: (() => void) | undefined
  #accountUnsubscribe: (() => void) | undefined
  #navigationUnsubscribe: (() => void) | undefined
  #stateUnsubscribe: (() => void) | undefined
  #publishedRun: ArchiveCollectionRun | undefined

  constructor(
    readonly store: ArchiveV4Store,
    private readonly stateStore: ConversationStateStore,
    private readonly settingsAdapter: SettingsAdapter,
    readonly collectionSession: ArchiveCollectionSession,
  ) {}

  async start() {
    if (this.#active) return
    this.#active = true
    this.#revokeWrites()
    const lifecycle = ++this.#lifecycleEpoch
    const settingsVersion = this.#settingsVersion
    this.#pageUnsubscribe = this.stateStore.subscribePages(this.#onPage)
    this.#catalogUnsubscribe = this.stateStore.subscribeCatalog(this.#onCatalog)
    this.#settingsUnsubscribe = this.settingsAdapter.subscribe((settings) => {
      this.#settingsVersion++
      const run = this.collectionSession.current()
      const rule = (value: BoosterSettings) =>
        run
          ? JSON.stringify(
              captureRuleForOperation(
                value.archive,
                run.conversationId,
                run.projectId,
                true,
                value.enabled,
              ),
            )
          : ''
      const policyChanged =
        this.#settings.enabled !== settings.enabled || rule(this.#settings) !== rule(settings)
      const archiveChanged =
        JSON.stringify([this.#settings.enabled, this.#settings.archive]) !==
        JSON.stringify([settings.enabled, settings.archive])
      if (archiveChanged) this.#revokeWrites()
      this.#settings = settings
      // Revoked queued pages cannot drain into a success outcome for an unchanged run.
      if (run && (policyChanged || archiveChanged))
        this.collectionSession.pause('policy_changed', run)
      this.#captureCurrentPages()
      this.#publishPolicy()
    })
    this.#sessionUnsubscribe = this.collectionSession.subscribe(() => {
      const run = this.collectionSession.current()
      if (run === this.#publishedRun) return
      this.#publishedRun = run
      this.#publishPolicy()
    })
    this.#accountUnsubscribe = this.stateStore.subscribeAccount(this.#onContextBoundary)
    this.#navigationUnsubscribe = observeChatGptNavigation(this.#onContextBoundary)
    this.#storeUnsubscribe = this.store.subscribe((change) => {
      if (change.accountId !== this.stateStore.verifiedAccountId()) return
      if (change.kind === 'cleared') {
        this.#revokeWrites()
        this.collectionSession.pause('policy_changed')
      }
      window.dispatchEvent(new Event(ARCHIVE_UPDATED_EVENT))
    })
    this.#stateUnsubscribe = this.stateStore.subscribe((change) => {
      const run = this.collectionSession.current()
      if (!run || change.conversationId !== run.conversationId) return
      if (change.reason === 'request') this.collectionSession.pause('selection_changed', run)
      else this.#onContextChange()
    })
    window.addEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStopRequested)
    window.addEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, this.#onIncompatible)
    document.addEventListener('visibilitychange', this.#onVisibility)
    window.addEventListener('pagehide', this.#onPageHide)
    const initialSettings = await this.settingsAdapter.get()
    if (!this.#active || lifecycle !== this.#lifecycleEpoch) return
    if (settingsVersion === this.#settingsVersion) this.#settings = initialSettings
    this.#captureCurrentPages()
    this.#publishPolicy()
  }

  stop() {
    this.collectionSession.pause('runtime_stopped')
    this.#active = false
    this.#lifecycleEpoch++
    this.#revokeWrites()
    this.#pageUnsubscribe?.()
    this.#pageUnsubscribe = undefined
    this.#catalogUnsubscribe?.()
    this.#catalogUnsubscribe = undefined
    this.#settingsUnsubscribe?.()
    this.#settingsUnsubscribe = undefined
    if (this.#ticketTimer) clearTimeout(this.#ticketTimer)
    this.#ticketTimer = undefined
    this.#sessionUnsubscribe?.()
    this.#accountUnsubscribe?.()
    this.#navigationUnsubscribe?.()
    this.#stateUnsubscribe?.()
    this.#storeUnsubscribe?.()
    this.#storeUnsubscribe = undefined
    this.#sessionUnsubscribe = undefined
    this.#accountUnsubscribe = undefined
    this.#navigationUnsubscribe = undefined
    this.#stateUnsubscribe = undefined
    window.removeEventListener(HISTORY_LOADER_STOP_EVENT, this.#onStopRequested)
    window.removeEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, this.#onIncompatible)
    document.removeEventListener('visibilitychange', this.#onVisibility)
    window.removeEventListener('pagehide', this.#onPageHide)
  }

  #onStopRequested = (event: Event) => {
    this.stopCollection((event as CustomEvent<HistoryLoaderStopRequest>).detail)
  }
  stopCollection(request: HistoryLoaderStopRequest = {}) {
    const run = this.collectionSession.current()
    if (!run) return
    if (request?.conversationId && request.conversationId !== run.conversationId) return
    if (request?.sessionId !== undefined && request.sessionId !== run.id) return
    const reason = request?.reason
    // Window events are only presentation commands; never forward arbitrary text.
    this.collectionSession.pause(
      reason === 'export_closed' ||
        reason === 'export_suspended' ||
        reason === 'tab_hidden' ||
        reason === 'navigation'
        ? reason
        : 'user',
      run,
    )
  }
  #onVisibility = () => {
    if (document.hidden) this.collectionSession.pause('tab_hidden')
  }
  #onPageHide = () => {
    this.#revokeWrites()
    this.collectionSession.pause('runtime_stopped')
  }
  #onIncompatible = (event: Event) => {
    const id = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId
    if (!id) return
    this.#sourceWrites.revoke(id)
    const run = this.collectionSession.current()
    if (run?.conversationId === id) this.collectionSession.pause('source_incompatible', run)
  }
  #revokeWrites() {
    this.#epoch++
    this.#writes.abort(new DOMException('Archive context revoked', 'AbortError'))
    this.#writes = new AbortController()
    this.#sourceWrites.clear()
  }
  #onContextBoundary = () => {
    this.#revokeWrites()
    this.#onContextChange()
    // Even a native route change within the same conversation revokes this run's queue.
    const run = this.collectionSession.current()
    if (run) this.collectionSession.pause('navigation', run)
  }

  /** Exactly one account cleanup may own the local write barrier at a time. */
  async clearSavedAccount(accountId: string) {
    if (this.stateStore.verifiedAccountId() !== accountId) throw new Error('archive.error.auth')
    // Repeated clear commands join the same transaction. Starting another one
    // would revoke the first signal and allow its finally block to reopen
    // capture while the second account deletion is still pending.
    if (this.#clearOperation) return this.#clearOperation
    this.#clearing = true
    this.#revokeWrites()
    const signal = this.#writes.signal
    const operation = Promise.resolve().then(() =>
      this.store.clearAccount(
        accountId,
        () => this.stateStore.verifiedAccountId() === accountId,
        signal,
      ),
    )
    this.#clearOperation = operation
    this.collectionSession.pause('user')
    try {
      await operation
    } finally {
      if (this.#clearOperation === operation) {
        this.#clearOperation = undefined
        this.#clearing = false
      }
    }
  }

  #onContextChange = () => {
    const run = this.collectionSession.current()
    if (!run) return
    if (this.stateStore.verifiedAccountId() !== run.accountId)
      this.collectionSession.pause('account_changed', run)
    else if (currentConversationId() !== run.conversationId)
      this.collectionSession.pause('navigation', run)
    else {
      const snapshot = this.stateStore.header(run.conversationId)
      const head = snapshot?.currentNodeId ?? null
      if (
        (run.selectedTipId && head && run.selectedTipId !== head) ||
        (run.sourceReadId && snapshot?.headReadId && snapshot.headReadId !== run.sourceReadId)
      )
        this.collectionSession.pause('selection_changed', run)
      else if (snapshot && snapshot.projectId !== run.projectId)
        this.collectionSession.pause('policy_changed', run)
    }
  }

  /** Same native safety checks for explanatory UI and an actual manual start. */
  collectionBlocker(conversationId: string): ArchiveCollectionBlocker | null {
    if (!this.#active) return 'unavailable'
    if (!currentConversationId() || currentConversationId() !== conversationId) return 'not_current'
    if (!this.stateStore.verifiedAccountId()) return 'account_unverified'
    if (!this.store.sourceGate.registered || this.store.sourceGate.get(conversationId))
      return 'source_incompatible'
    if (!this.#settings.enabled) return 'disabled'
    if (hasConversationDraft()) return 'draft'
    if (hasPendingComposerAttachments()) return 'attachments'
    if (isConversationGenerating()) return 'generating'
    return null
  }

  /** Explicit, temporary collection permission; native history loads by UI scroll. */
  async collectCurrent(): Promise<void> {
    const id = currentConversationId()
    if (!id) throw new Error('archive.error.noChat')
    const blocker = this.collectionBlocker(id)
    if (blocker) {
      const errors: Record<ArchiveCollectionBlocker, string> = {
        not_current: 'archive.error.noChat',
        unavailable: 'archive.error.noChat',
        disabled: 'archive.error.disabled',
        account_unverified: 'archive.error.auth',
        source_incompatible: 'archive.error.incompatibleSource',
        draft: 'archive.error.draft',
        attachments: 'archive.error.attachments',
        generating: 'archive.error.generating',
      }
      throw new Error(errors[blocker])
    }
    if (document.hidden) throw new Error('archive.error.tabHidden')
    const accountId = this.stateStore.verifiedAccountId()
    if (!accountId) throw new Error('archive.error.auth')
    const snapshot = this.stateStore.header(id)
    const sourceRead = this.stateStore
      .pages(id)
      .filter(
        (page) =>
          page.isInitial &&
          page.readId &&
          page.accountId === accountId &&
          page.payload.current_node === snapshot?.currentNodeId,
      )
      .sort(
        (a, b) =>
          (b.readStartedAt ?? b.timestamp) - (a.readStartedAt ?? a.timestamp) ||
          b.timestamp - a.timestamp,
      )[0]
    const run = this.collectionSession.begin({
      accountId,
      conversationId: id,
      projectId: snapshot?.projectId ?? null,
      selectedTipId: snapshot?.currentNodeId ?? null,
      sourceReadId: sourceRead?.readId ?? null,
      sourceReadStartedAt: sourceRead?.readStartedAt ?? null,
    })
    // A subscriber may synchronously reject the start; never grant capture afterwards.
    this.collectionSession.requireCurrent(run)
    this.#captureCurrentPages()
  }

  /** Collection is complete only after every queued page for the run has settled. */
  async completeCollection(run: ArchiveCollectionRun): Promise<void> {
    this.collectionSession.requireCurrent(run)
    this.collectionSession.update(run, { phase: 'saving', hasOlderServerHistory: false })
    while (true) {
      const pending = [...(this.#pendingByRun.get(run) ?? [])]
      await this.collectionSession.waitFor(run, Promise.all(pending))
      if (this.#pendingByRun.get(run)?.size) continue
      this.collectionSession.requireCurrent(run)
      this.collectionSession.complete(run)
      return
    }
  }

  #publishPolicy() {
    if (!this.#active) return
    if (this.#ticketTimer) clearTimeout(this.#ticketTimer)
    this.#ticketTimer = undefined
    const ticket = this.collectionSession.current()
    if (ticket)
      this.#ticketTimer = setTimeout(
        () => {
          this.collectionSession.expire(ticket)
          if (this.collectionSession.owns(ticket)) this.#publishPolicy()
        },
        Math.max(1, ticket.expiresAt - Date.now()),
      )
    const settings = this.#settings
    const detail = {
      enabled: settings.enabled,
      defaultEnabled: settings.archive.defaultRule.enabled,
      projects: Object.fromEntries(
        Object.entries(settings.archive.projects).map(([id, rule]) => [id, rule.enabled]),
      ),
      conversations: Object.fromEntries(
        Object.entries(settings.archive.conversations).map(([id, rule]) => [id, rule.enabled]),
      ),
      manualConversationId: ticket?.conversationId ?? null,
      manualStartedAt: ticket?.startedAt ?? null,
    }
    const signature = JSON.stringify(detail)
    if (signature === this.#policySignature) return
    this.#policySignature = signature
    window.postMessage(
      { channel: TRANSPORT_CHANNEL, type: ARCHIVE_POLICY_EVENT, detail },
      location.origin,
    )
  }

  /** Called when explicit Export collection consent is granted or renewed. */
  captureBufferedCurrent() {
    this.#captureCurrentPages()
  }

  #captureCurrentPages() {
    if (!this.#active) return
    const conversationId = currentConversationId()
    if (!conversationId) return
    for (const page of this.stateStore.pages(conversationId)) this.#onPage(page)
  }

  #onCatalog = (detail: ConversationCatalogEventDetail) => {
    if (!this.#active || this.#clearing || !this.#settings.enabled) return
    const accountId = this.stateStore.verifiedAccountId()
    if (!accountId || detail.accountId !== accountId) return
    // Automatic capture policy applies at enqueue. Mere visibility in a catalog
    // neither creates saved conversations nor borrows another chat's manual run.
    const items = detail.items.filter(
      (item) =>
        captureRuleForOperation(
          this.#settings.archive,
          item.conversationId,
          item.projectKnown === true
            ? item.projectId
            : (item.projectId ?? this.stateStore.header(item.conversationId)?.projectId ?? null),
          false,
          this.#settings.enabled,
        ).enabled,
    )
    if (!items.length) return
    const snapshot = structuredClone({ ...detail, items })
    const epoch = this.#epoch
    const sourceLeases = items.map((item) => this.#sourceWrites.acquire(item.conversationId))
    const scope = archiveWriteScope([
      this.#writes.signal,
      ...sourceLeases.map((lease) => lease.signal),
    ])
    const signal = scope.signal
    const permitted = () =>
      this.#active &&
      !this.#clearing &&
      !signal.aborted &&
      epoch === this.#epoch &&
      accountId === this.stateStore.verifiedAccountId()
    const ticket = this.store.acquireWriteTicket(accountId).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    )
    this.#pending = this.#pending
      .then(async () => {
        const acquired = await ticket
        if (!permitted()) return
        if (!acquired.value) throw acquired.error
        await this.store.applyCatalog(snapshot, accountId, permitted, {
          ticket: acquired.value,
          signal,
        })
      })
      .catch((cause: unknown) => {
        if (permitted())
          this.#captureFailed(accountId, items[0]?.conversationId ?? '', undefined, cause)
      })
      .finally(() => {
        scope.close()
        for (const lease of sourceLeases) lease.release()
      })
  }

  #onPage = (incoming: ConversationArchiveEventDetail) => {
    if (!this.#active || this.#clearing || !this.#settings.enabled) return
    const accountId = this.stateStore.verifiedAccountId()
    if (!accountId || incoming.accountId !== accountId) return
    const conversationId = incoming.conversationId
    const projectId = Object.hasOwn(incoming.payload, 'gizmo_id')
      ? normalizeConversationProjectId(incoming.payload)
      : (this.stateStore.header(conversationId)?.projectId ?? null)
    const candidate = this.collectionSession.current()
    const run =
      currentConversationId() === conversationId &&
      this.collectionSession.permits(candidate, accountId, conversationId)
        ? candidate
        : undefined
    const rule = captureRuleForOperation(
      this.#settings.archive,
      conversationId,
      projectId,
      !!run,
      this.#settings.enabled,
    )
    if (!rule.enabled) return
    // Permission is selected NOW. New policy, account or manual consent never upgrades this work.
    const sourceLease = this.#sourceWrites.acquire(conversationId)
    const scope = archiveWriteScope([this.#writes.signal, run?.signal, sourceLease.signal])
    let page: ConversationArchiveEventDetail
    try {
      page = structuredClone(incoming)
    } catch (cause) {
      scope.close()
      sourceLease.release()
      this.#captureFailed(accountId, conversationId, run, cause)
      return
    }
    const selections = new Map<string, ArchiveSubmissionSnapshot>()
    if (Array.isArray(page.payload.messages))
      for (const raw of page.payload.messages) {
        const id = asRecord(raw)?.id
        if (typeof id !== 'string') continue
        const selection = this.stateStore.submissionSelection(conversationId, id)
        if (selection) selections.set(id, selection)
      }
    const work: CapturedPageWork = {
      page,
      accountId,
      projectId,
      epoch: this.#epoch,
      rule: { ...rule },
      run,
      signal: scope.signal,
      selections,
    }
    // Acquire the account's durable clear-generation before this page waits in the queue.
    const ticket = this.store.acquireWriteTicket(accountId).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    )
    const task: Promise<void> = this.#pending
      .then(async () => {
        if (!this.#permitted(work)) return
        const result = await ticket
        if (!this.#permitted(work)) return
        if (!result.value) throw result.error
        await this.#persistPage(work, result.value)
      })
      .catch((cause: unknown) => {
        if (!work.signal.aborted && work.epoch === this.#epoch)
          this.#captureFailed(accountId, conversationId, run, cause)
      })
      .finally(() => {
        scope.close()
        sourceLease.release()
        if (run) {
          const pending = this.#pendingByRun.get(run)
          pending?.delete(task)
          if (!pending?.size) this.#pendingByRun.delete(run)
        }
      })
    this.#pending = task
    if (run) {
      const pending = this.#pendingByRun.get(run) ?? new Set<Promise<void>>()
      pending.add(task)
      this.#pendingByRun.set(run, pending)
    }
  }

  #captureFailed(
    accountId: string,
    conversationId: string,
    run: ArchiveCollectionRun | undefined,
    cause: unknown,
  ) {
    if (run)
      this.collectionSession.fail(
        run,
        cause instanceof ArchiveContractError
          ? 'archive.error.incompatibleSource'
          : 'archive.error.storage',
      )
    if (accountId !== this.stateStore.verifiedAccountId()) return
    window.dispatchEvent(
      new CustomEvent('chatgpt-booster:archive-storage-error', {
        detail: {
          conversationId,
          kind: cause instanceof ArchiveContractError ? 'incompatible_source_contract' : 'storage',
        },
      }),
    )
  }

  #permitted(work: CapturedPageWork): boolean {
    if (
      !this.#active ||
      this.#clearing ||
      work.signal.aborted ||
      work.epoch !== this.#epoch ||
      !this.#settings.enabled ||
      this.stateStore.verifiedAccountId() !== work.accountId
    )
      return false
    if (
      work.run &&
      (currentConversationId() !== work.page.conversationId ||
        !this.collectionSession.permits(work.run, work.accountId, work.page.conversationId))
    )
      return false
    const current = captureRuleForOperation(
      this.#settings.archive,
      work.page.conversationId,
      work.projectId,
      !!work.run,
      this.#settings.enabled,
    )
    return current.enabled && JSON.stringify(current) === JSON.stringify(work.rule)
  }

  async #persistPage(work: CapturedPageWork, ticket: ArchiveV4WriteTicket) {
    const permitted = () => this.#permitted(work)
    if (!permitted()) return
    const { page, accountId, projectId, rule, signal } = work
    const result = await this.store.ingest(
      page,
      accountId,
      permitted,
      (raw) => retainRawSource(raw, rule),
      work.selections,
      { ticket, signal },
    )
    if (!result && work.run && permitted()) throw new Error('archive.error.sourceChanged')
    // Store notifications are emitted only after a real committed delta, including other tabs.
    if (!result || !projectId || !permitted() || currentConversationId() !== page.conversationId)
      return
    const title = currentProjectTitle(projectId)
    if (title)
      await this.store.upsertProject(accountId, projectId, title, Date.now(), permitted, {
        ticket,
        signal,
      })
  }
}
