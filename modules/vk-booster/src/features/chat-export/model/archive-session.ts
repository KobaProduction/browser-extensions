import { createArchiveChangeFeed } from '@kobaproduction/browser-archive'
import { type DeliveryTarget, instanceScope } from '@kobaproduction/browser-core'
import { VK_BASE_VERSION } from '../../../version'
import { createVkProvider } from '../api/vk-provider'
import { FixedVkDexieRepository } from './archive-fixed-dexie'
import { conversationPeerFromLocation } from './conversation-context'
import { defaultVkCapturePreferences, validateVkCapturePreferences } from './settings-backup'
import type { ArchiveOptions, ArchiveProgress, ArchiveStatus, VkCaptureEvidence } from './types'

/** Scoped owner/context and operation state shared by the active VK use cases. */
export interface VkArchiveDependencies {
  readonly sleep?: (ms: number) => Promise<void>
}
export function createVkArchiveSession(
  target: DeliveryTarget,
  dependencies: VkArchiveDependencies = {},
) {
  const scope = instanceScope()
  if (!/^(vk-booster|all-in-one):(dev|prod)$/.test(scope))
    throw Error('Unsupported VK installation scope')
  const state = { busy: false, backupRunning: false, stopRequested: false, disposed: false }
  const currentPeer = () => (state.disposed ? null : conversationPeerFromLocation(location))
  const cfg: ArchiveOptions = {
    peerId: currentPeer() ?? 0,
    ...defaultVkCapturePreferences(),
  }
  let prog: ArchiveProgress = {
    phase: 'Ожидание',
    done: 0,
    total: 0,
    newCount: 0,
    downloaded: 0,
    failed: 0,
  }
  const subscribers = new Set<(status: ArchiveStatus) => void>()
  const archiveChanges = createArchiveChangeFeed(`koba-archive:${scope}:vk-booster`)
  // Current-session source evidence never changes schema1 or enters preferences.
  let captureEvidence: VkCaptureEvidence | undefined
  const setCaptureEvidence = (value: VkCaptureEvidence | undefined) => {
    captureEvidence = value
  }
  const getCaptureEvidence = () => captureEvidence
  function status(): ArchiveStatus {
    const peer = currentPeer()
    if (!state.busy && peer !== null) cfg.peerId = peer
    return {
      version: VK_BASE_VERSION,
      archiveRevision: archiveChanges.revision(),
      folder: null,
      activePeerId: peer,
      blockedReason:
        peer === null
          ? 'Открой переписку VK.'
          : peer !== cfg.peerId
            ? 'Активная переписка изменилась.'
            : null,
      busy: state.busy,
      folderPending: false,
      options: { ...cfg },
      progress: { ...prog },
      messages: 0,
      checkpoint: null,
    }
  }
  function refresh() {
    const snapshot = status()
    for (const listener of subscribers)
      try {
        listener(snapshot)
      } catch {}
  }
  const unsubscribeArchive = archiveChanges.subscribe(refresh)
  const sleep =
    dependencies.sleep ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)))
  const provider = createVkProvider(cfg, { sleep, refresh })
  const auth = () => (state.disposed ? Promise.resolve(false) : provider.auth())
  const api = (method: string, params: Record<string, string | number>) =>
    state.disposed
      ? Promise.reject(Error('VK archive service is stopped'))
      : provider.api(method, params)
  const history = (offset: number, count: number, startMessageId?: number) =>
    provider.history(offset, count, startMessageId)
  function applyPreferences(value: Partial<ArchiveOptions>, duringBackup: boolean): ArchiveStatus {
    if (state.busy || (!duringBackup && state.backupRunning) || state.disposed)
      throw Error('Заверши текущую операцию с архивом')
    const peer = currentPeer()
    const candidate = { ...cfg, ...value, peerId: value.peerId ?? peer ?? cfg.peerId }
    if (peer !== null && candidate.peerId !== peer) throw Error('Выбран другой диалог VK')
    const { mode, limit, from, through, pageSize, delay, media } = candidate
    Object.assign(
      cfg,
      validateVkCapturePreferences({ mode, limit, from, through, pageSize, delay, media }),
      { peerId: candidate.peerId },
    )
    refresh()
    return status()
  }
  const configure = (value: Partial<ArchiveOptions> = {}) => applyPreferences(value, false)
  const configureDuringBackup = (value: Partial<ArchiveOptions> = {}) => applyPreferences(value, true)
  function progress(phase: string, done: number, total: number, extra: Partial<ArchiveProgress> = {}) {
    prog = { phase, done, total, ...extra }
    refresh()
  }
  async function verifiedOwner(peerId: number | null): Promise<string> {
    if (state.disposed) throw Error('VK archive service is stopped')
    const result = await api('users.get', {})
    const first = Array.isArray(result) ? result[0] : undefined
    const owner = first && typeof first === 'object' ? (first as { id?: unknown }).id : undefined
    if (typeof owner !== 'number' || !Number.isSafeInteger(owner) || owner <= 0)
      throw Error('Authenticated VK account verification required for Dexie')
    if (state.disposed || currentPeer() !== peerId)
      throw Error('VK peer changed during account verification')
    return `vk-user-${owner}`
  }
  async function verifyOwner(ownerId: string, peerId: number | null): Promise<void> {
    if ((await verifiedOwner(peerId)) !== ownerId)
      throw Error('VK archive account changed during operation')
  }
  async function openFixedArchive(peerId: number | null): Promise<FixedVkDexieRepository> {
    const ownerId = await verifiedOwner(peerId)
    return new FixedVkDexieRepository({
      productId: 'vk-booster',
      channel: scope.endsWith(':dev') ? 'dev' : 'prod',
      installationId: `${scope.split(':')[0]}-${target}`,
      ownerId,
    })
  }
  async function withFixed<T>(
    operation: (repo: FixedVkDexieRepository, peerId: number) => Promise<T>,
    allowBackup = false,
    allowCaptureRead = false,
  ): Promise<T> {
    const peerId = currentPeer()
    if (
      state.disposed ||
      !peerId ||
      (state.busy && !allowCaptureRead) ||
      (!allowBackup && state.backupRunning)
    )
      throw Error('VK conversation is not available')
    cfg.peerId = peerId
    if (!(await auth())) throw Error('VK API authorization unavailable')
    const repo = await openFixedArchive(peerId)
    try {
      const result = await operation(repo, peerId)
      if (state.disposed || currentPeer() !== peerId)
        throw Error('VK peer changed during fixed archive read')
      if (!repo.scope.ownerId) throw Error('Verified VK owner unavailable')
      await verifyOwner(repo.scope.ownerId, peerId)
      return result
    } finally {
      repo.close()
    }
  }
  function subscribe(listener: (value: ArchiveStatus) => void) {
    subscribers.add(listener)
    listener(status())
    return () => {
      subscribers.delete(listener)
    }
  }
  function stop() {
    state.stopRequested = true
    refresh()
  }
  function destroy() {
    state.disposed = true
    state.stopRequested = true
    provider.destroy()
    unsubscribeArchive()
    archiveChanges.close()
    subscribers.clear()
  }
  return {
    target,
    state,
    cfg,
    currentPeer,
    status,
    refresh,
    progress,
    configure,
    configureDuringBackup,
    subscribe,
    stop,
    destroy,
    sleep,
    auth,
    api,
    history,
    openFixedArchive,
    verifyOwner,
    withFixed,
    archiveChanges,
    setCaptureEvidence,
    getCaptureEvidence,
  }
}
export type VkArchiveSession = ReturnType<typeof createVkArchiveSession>
