import { archiveSha256Hex, createGzipFromChunks, encodeArchiveClone } from '@kobaproduction/browser-archive'
import { instanceScope } from '@kobaproduction/browser-core'
import { captureRuleForOperation, type BoosterModule, type SettingsAdapter } from '@chatgpt-booster/core'
import { currentConversationId } from '@chatgpt-booster/chatgpt'
import type { DexieOptions } from 'dexie'
import type { ArchiveCollectionSession } from './archive-collection-session'
import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import { NATIVE_HISTORY_CONTRACT_VERSION } from './archive-source-contract'
import { FixedCanonicalDexieRepository } from './archive-fixed-dexie'
import type { ConversationStateStore } from './conversation-state'
import { retainRawSource } from './archive-v4-capture'

export interface FixedChatGptView {
  currentConversationId(): string | null
  listCurrent(limit?: number): Promise<readonly { id: string; text: string; coverage: string }[]>
  exportCurrent(): Promise<Blob>
  savedCurrent(): Promise<number>
  captureFailed(): boolean
}
function scopeIdentity(label: string): { channel: 'dev' | 'prod'; installationId: string } {
  const compiled = instanceScope() || 'chatgpt-booster:prod'
  if (!/^(chatgpt-booster|all-in-one):(dev|prod)$/.test(compiled))
    throw Error('Unsupported ChatGPT installation scope')
  if (!['Tampermonkey', 'Chromium'].includes(label)) throw Error('Unknown browser adapter')
  return {
    channel: compiled.endsWith(':dev') ? 'dev' : 'prod',
    installationId: `${compiled.split(':')[0]}-${label.toLowerCase()}`,
  }
}

/** New native-history pages -> fixed Dexie v1. No legacy data scan or conversion. */
export class FixedChatGptCapture implements BoosterModule, FixedChatGptView {
  readonly id = 'fixed-dexie-capture'
  private unsubscribe: (() => void) | undefined
  private unsubscribeSettings: (() => void) | undefined
  private policyEpoch = 0
  private pending: Promise<void> = Promise.resolve()
  private readonly repositories = new Map<string, FixedCanonicalDexieRepository>()
  private stopped = true
  private readonly identity: ReturnType<typeof scopeIdentity>
  private failure: Error | undefined

  constructor(
    private readonly state: ConversationStateStore,
    private readonly settings: SettingsAdapter,
    targetLabel: string,
    private readonly collectionSession?: ArchiveCollectionSession,
    private readonly dbOptions?: DexieOptions,
  ) {
    this.identity = scopeIdentity(targetLabel)
  }
  private repo(owner: string): FixedCanonicalDexieRepository {
    let store = this.repositories.get(owner)
    if (!store) {
      store = new FixedCanonicalDexieRepository({
        productId: 'chatgpt-booster', channel: this.identity.channel,
        installationId: this.identity.installationId, ownerId: owner,
      }, this.dbOptions)
      this.repositories.set(owner, store)
    }
    return store
  }
  start() {
    if (!this.stopped) return
    this.stopped = false
    this.unsubscribeSettings = this.settings.subscribe(() => { this.policyEpoch++ })
    const enqueue = (page: ConversationArchiveEventDetail) => {
      const owner = this.state.verifiedAccountId()
      const epoch = this.state.accountEpoch()
      if (!owner || (page.accountId !== undefined && page.accountId !== owner)) return
      this.pending = this.pending.then(() => this.capture(page, owner, epoch))
        .catch(error => {
          this.failure = error instanceof Error ? error : Error('Fixed Dexie capture failed')
          // Do not print source messages, URLs or confidential exception text.
          console.warn('[ChatGPT Booster] Fixed archive capture:', this.failure.name)
        })
    }
    this.unsubscribe = this.state.subscribePages(enqueue)
    // Native pages observed during early capture are still in current-session RAM.
    // Replay RAM only, never old v3/v4 IndexedDB generations.
    for (const snapshot of this.state.listSnapshots())
      for (const page of snapshot.pages) enqueue(page)
  }
  private async capture(page: ConversationArchiveEventDetail, owner: string, epoch: number) {
    if (this.stopped || this.state.accountEpoch() !== epoch ||
        this.state.verifiedAccountId() !== owner) return
    const settings = await this.settings.get()
    const header = this.state.header(page.conversationId)
    const session = this.collectionSession?.current()
    const manual = Boolean(this.collectionSession?.permits(session, owner, page.conversationId))
    const rule = captureRuleForOperation(
      settings.archive, page.conversationId, header?.projectId ?? null, manual, settings.enabled,
    )
    if (!rule.enabled || !Array.isArray(page.payload.messages)) return
    const policyEpoch = this.policyEpoch
    const stillAuthorized = () =>
      !this.stopped && this.state.accountEpoch() === epoch &&
      this.state.verifiedAccountId() === owner &&
      this.policyEpoch === policyEpoch &&
      (!manual || Boolean(this.collectionSession?.permits(
        this.collectionSession.current(), owner, page.conversationId,
      )))
    const store = this.repo(owner)
    for (const candidate of page.payload.messages) {
      if (!stillAuthorized()) return
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const raw = candidate as Record<string, unknown>
      if (typeof raw.id !== 'string' || !raw.id || !retainRawSource(raw, rule)) continue
      const existing = await store.getSourceSnapshot(page.conversationId, raw.id)
      if (existing) {
        // Never overwrite a prior source snapshot or invent edit semantics.
        if (JSON.stringify(existing.raw) !== JSON.stringify(raw))
          throw Error('Original message changed; explicit revision support required')
        continue
      }
      if (!stillAuthorized()) return
      await store.addObservation({
        accountId: owner,
        conversationId: page.conversationId,
        projectId: header?.projectId ?? null,
        conversationTitle: header?.title ?? null,
        sourceKind: 'native',
        sourceVersion: NATIVE_HISTORY_CONTRACT_VERSION,
        observedAtMs: page.timestamp,
        raw,
      }, stillAuthorized)
    }
  }
  currentConversationId() { return currentConversationId() ?? null }
  captureFailed() { return Boolean(this.failure) }
  async savedCurrent(): Promise<number> {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const id = this.currentConversationId()
    if (!owner || !id) throw Error('Verified account and current conversation required')
    const epoch = this.state.accountEpoch()
    const count = await this.repo(owner).countConversation(id)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner ||
        this.currentConversationId() !== id)
      throw Error('Account or conversation changed during fixed archive count')
    return count
  }
  async listCurrent(limit = 80): Promise<readonly { id: string; text: string; coverage: string }[]> {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const id = this.currentConversationId()
    if (!owner || !id) throw Error('Verified account and current conversation required')
    const epoch = this.state.accountEpoch()
    const messages = await this.repo(owner).listMessages(id, limit)
    if (this.state.accountEpoch() !== epoch || this.state.verifiedAccountId() !== owner)
      throw Error('Account changed during fixed Dexie read')
    return messages.map(row => ({
      id: row.messageId,
      text: row.projection.elements.filter(element => element.kind === 'text')
        .map(element => element.text ?? '').join('\n').slice(0, 600),
      coverage: row.projection.renderCoverage,
    }))
  }
  async exportCurrent(): Promise<Blob> {
    await this.pending
    const owner = this.state.verifiedAccountId()
    const id = this.currentConversationId()
    if (!owner || !id) throw Error('Verified account and current conversation required')
    const epoch = this.state.accountEpoch()
    const store = this.repo(owner)
    const assertOwner = () => {
      if (this.stopped || this.state.accountEpoch() !== epoch ||
          this.state.verifiedAccountId() !== owner ||
          this.currentConversationId() !== id) throw Error('Account or conversation changed during export')
    }
    let digest = 'start'
    let count = 0
    const source = async function* () {
      const encode = async (row: Record<string, unknown>, footer = false) => {
        const line = JSON.stringify(row)
        if (!footer) digest = await archiveSha256Hex(digest + '\n' + line)
        return new TextEncoder().encode(line + '\n')
      }
      yield await encode({ kind: 'header', schema: 'koba-fixed-chatgpt-v1', owner,
        conversationId: id, completeness: 'unknown', sourceEncoding: 'archive-structured-clone' })
      let cursor: string | undefined
      while (true) {
        assertOwner()
        const records = await store.listMessages(id, 128, cursor)
        if (!records.length) break
        for (const item of records) {
          assertOwner()
          const snapshot = await store.getSourceSnapshot(id, item.messageId)
          if (!snapshot) throw Error('Missing immutable source snapshot')
          yield await encode({ kind: 'message', canonical: item, snapshot: { ...snapshot, raw: await encodeArchiveClone(snapshot.raw) } })
          count++
        }
        cursor = records.at(-1)?.messageId
        if (records.length < 128) break
      }
      yield await encode({ kind: 'footer', count, digest }, true)
    }
    const result = await createGzipFromChunks(source())
    assertOwner()
    return result
  }
  async stop() {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = undefined
    await this.pending
    for (const store of this.repositories.values()) store.close()
    this.repositories.clear()
  }
}
