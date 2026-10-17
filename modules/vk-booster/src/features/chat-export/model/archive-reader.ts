import {
  type ArchiveMessageV1,
  archiveMessageText,
  archiveSha256Hex,
  collectArchiveRange,
  createGzipFromChunks,
  encodeArchiveClone,
  linearArchiveIntegrity,
} from '@kobaproduction/browser-archive'
import { assets } from '../api/vk-assets'
import { downloadVkAttachment } from '../api/vk-attachment-download'
import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkArchiveSession } from './archive-session'
import type {
  VkArchiveCoverage,
  VkDownloadedAttachment,
  VkMessage,
  VkReaderWindow,
  VkTimelineEntry,
} from './types'
import { verifiedVkParticipants } from './vk-participants'
import { createVkUserExport, type VkExportProgress, type VkUserExportOptions } from './vk-user-export'
/** Bounded saved reads, participant labels and user exports. */
export function createVkArchiveReader(session: VkArchiveSession) {
  const { state, currentPeer, auth, api, withFixed, archiveChanges } = session
  const mediaRequests = new Set<AbortController>()
  const mediaReceipts = new Map<
    string,
    VkDownloadedAttachment & { ownerId: string; peerId: number; revision: number }
  >()
  let mediaBytes = 0
  let mediaReservedBytes = 0
  let mediaScope: string | null = null
  function disposeReader() {
    for (const request of mediaRequests) request.abort()
    mediaRequests.clear()
    mediaReceipts.clear()
    mediaBytes = 0
    mediaScope = null
  }
  async function downloadAttachmentFixed(
    messageId: number,
    assetKey: string,
    signal?: AbortSignal,
  ): Promise<VkDownloadedAttachment> {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || !assetKey)
      throw Error('Invalid VK attachment identity')
    const request = new AbortController(),
      abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 30000)
    mediaRequests.add(request)
    let reservedBytes = 0
    let release: () => void = () => {
      throw Error('VK attachment context unavailable')
    }
    try {
      const result = await withFixed(async (repo, peerId) => {
        const revision = archiveChanges.revision(),
          ownerId = repo.scope.ownerId
        if (!ownerId) throw Error('Verified VK attachment owner required')
        const scope = JSON.stringify([ownerId, peerId, revision])
        if (scope !== mediaScope) {
          for (const pending of mediaRequests) if (pending !== request) pending.abort()
          mediaReceipts.clear()
          mediaBytes = 0
          mediaScope = scope
        }
        release = () => {
          request.signal.throwIfAborted()
          if (
            state.disposed ||
            currentPeer() !== peerId ||
            archiveChanges.revision() !== revision ||
            mediaScope !== scope
          )
            throw Error('VK conversation or archive changed during attachment download')
        }
        const assertCurrent = async () => {
          release()
          await session.verifyOwner(ownerId, peerId)
          release()
        }
        await assertCurrent()
        const source = await repo.getOriginal(peerId, messageId)
        await assertCurrent()
        if (!source) throw Error('VK attachment source snapshot missing')
        const asset = assets(source.raw).find((candidate) => candidate.key === assetKey)
        if (!asset || asset.type === 'link') throw Error('VK attachment source unavailable')
        const cached = mediaReceipts.get(assetKey)
        if (cached?.ownerId === ownerId && cached.peerId === peerId && cached.revision === revision)
          return {
            key: cached.key,
            name: cached.name,
            blob: cached.blob,
            size: cached.size,
            sha256: cached.sha256,
            mime: cached.mime,
          }
        const remaining = 512 * 1024 * 1024 - mediaBytes - mediaReservedBytes
        if (remaining <= 0) throw Error('VK attachment session memory limit reached')
        reservedBytes = Math.min(64 * 1024 * 1024, remaining)
        mediaReservedBytes += reservedBytes
        const result = await downloadVkAttachment(asset, {
          signal: request.signal,
          assertCurrent,
          maxBytes: reservedBytes,
        })
        await assertCurrent()
        const replaced = mediaReceipts.get(assetKey)
        const nextBytes = mediaBytes - (replaced?.size ?? 0) + result.size
        if (nextBytes > 512 * 1024 * 1024) throw Error('VK attachment session memory limit reached')
        mediaBytes = nextBytes
        mediaReceipts.set(assetKey, { ...result, ownerId, peerId, revision })
        return result
      })
      release()
      return result
    } finally {
      clearTimeout(timer)
      mediaReservedBytes -= reservedBytes
      signal?.removeEventListener('abort', abort)
      mediaRequests.delete(request)
    }
  }
  async function coverage(repo: FixedVkDexieRepository, peerId: number): Promise<VkArchiveCoverage> {
    const revision = archiveChanges.revision()
    const [savedCount, bounds] = await Promise.all([
      repo.countMessages(peerId),
      repo.messageBounds(peerId),
    ])
    if (revision !== archiveChanges.revision()) throw Error('VK archive changed while checking coverage')
    const candidate = session.getCaptureEvidence()
    const evidence =
      candidate?.peerId === peerId &&
      candidate.ownerId === repo.scope.ownerId &&
      candidate.archiveRevision === revision
        ? candidate
        : undefined
    const current = !!evidence
    const firstMatches = !!evidence && (bounds.first?.messageId ?? null) === evidence.firstId
    const lastMatches = !!evidence && (bounds.last?.messageId ?? null) === evidence.lastId
    return {
      savedCount,
      reportedCount: evidence?.reportedCount ?? null,
      first: bounds.first
        ? { id: bounds.first.messageId, text: bounds.first.text, date: bounds.first.date }
        : null,
      last: bounds.last
        ? { id: bounds.last.messageId, text: bounds.last.text, date: bounds.last.date }
        : null,
      observedAtMs: evidence?.observedAtMs ?? null,
      verification: current ? 'session-scan' : 'unknown',
      integrity: linearArchiveIntegrity({
        savedCount,
        reportedCount: evidence?.reportedCount ?? null,
        firstId: bounds.first ? String(bounds.first.messageId) : null,
        lastId: bounds.last ? String(bounds.last.messageId) : null,
        startReached: firstMatches && (evidence?.startReached ?? false),
        endReached: lastMatches && (evidence?.endReached ?? false),
        countStable: evidence?.countStable ?? false,
        current,
      }),
    }
  }
  const coverageFixed = () => withFixed((repo, peerId) => coverage(repo, peerId), false, true)
  const timelineFixed = (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    return withFixed(
      async (repo, peerId) => {
        const revision = archiveChanges.revision(),
          total = await repo.countMessages(peerId)
        const entries: VkTimelineEntry[] = []
        let cursor: number | undefined
        while (true) {
          signal?.throwIfAborted()
          if (revision !== archiveChanges.revision())
            throw Error('VK archive changed while reading timeline')
          const rows = await repo.listMessages(peerId, 128, cursor)
          for (const row of rows)
            entries.push({
              id: row.messageId,
              date: row.date,
              senderId: row.senderId,
              outgoing: row.outgoing,
              text: row.text?.slice(0, 160) ?? null,
            })
          if (rows.length < 128) break
          cursor = rows.at(-1)?.messageId
        }
        if (
          revision !== archiveChanges.revision() ||
          entries.length !== total ||
          (await repo.countMessages(peerId)) !== total
        )
          throw Error('VK archive changed while reading timeline')
        signal?.throwIfAborted()
        return entries
      },
      false,
      true,
    )
  }
  async function rangeFixed(firstMessageId: number, lastMessageId: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (![firstMessageId, lastMessageId].every((id) => Number.isSafeInteger(id) && id > 0))
      throw Error('Invalid VK range endpoints')
    return withFixed(async (repo, peerId) => {
      const revision = archiveChanges.revision()
      const verify = () => {
        signal?.throwIfAborted()
        if (revision !== archiveChanges.revision() || currentPeer() !== peerId)
          throw Error('VK archive changed during range selection')
      }
      async function* records() {
        let cursor: number | undefined
        while (true) {
          verify()
          const page = await repo.listMessages(peerId, 128, cursor)
          for (const row of page) {
            verify()
            yield row
          }
          if (page.length < 128) break
          cursor = page.at(-1)?.messageId
        }
      }
      const range = await collectArchiveRange(
        records(),
        { firstId: String(firstMessageId), lastId: String(lastMessageId) },
        (row) => String(row.messageId),
      )
      const [first, last] = await Promise.all([
        repo.getOriginal(peerId, range.first.messageId),
        repo.getOriginal(peerId, range.last.messageId),
      ])
      verify()
      if (!first || !last || first.ownerId !== repo.scope.ownerId || last.ownerId !== repo.scope.ownerId)
        throw Error('VK range original is missing')
      return { messageIds: range.messageIds.map(Number), first: first.raw, last: last.raw }
    })
  }
  async function resolveParticipants(userIds: readonly number[]) {
    const peerId = currentPeer()
    if (!peerId || state.busy || !userIds.length) return []
    const ids = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 100)
    if (!ids.length) return []
    if (!(await auth())) return []
    const response = await api('users.get', { user_ids: ids.join(','), fields: 'photo_100' })
    if (currentPeer() !== peerId) throw Error('VK peer changed while loading participant labels')
    return verifiedVkParticipants(response).filter((person) => ids.includes(person.id))
  }

  async function countFixed(): Promise<number> {
    return withFixed(async (repo, peerId) => repo.countMessages(peerId), false, true)
  }
  async function readFixed(limit = 80, afterMessageId?: number): Promise<readonly VkMessage[]> {
    return (await readWindowFixed(limit, afterMessageId)).messages
  }
  async function readWindowFixed(
    limit: number,
    afterMessageId?: number,
    expected?: { ownerId: string; revision?: number },
  ): Promise<VkReaderWindow> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw Error('Invalid fixed archive page size')
    return withFixed(
      async (repo, peerId) => {
        const revision = archiveChanges.revision()
        const ownerId = repo.scope.ownerId
        if (!ownerId || (expected && expected.ownerId !== ownerId))
          throw Error('VK archive reader owner changed')
        if (expected?.revision !== undefined && expected.revision !== revision)
          throw Error('VK archive changed while reading window')
        const rows = await repo.listMessages(peerId, limit, afterMessageId)
        const messages: VkMessage[] = []
        for (const row of rows) {
          const original = await repo.getOriginal(peerId, row.messageId)
          if (
            !original ||
            original.ownerId !== repo.scope.ownerId ||
            original.raw.id !== row.messageId ||
            (original.raw.peer_id !== undefined && original.raw.peer_id !== peerId)
          )
            throw Error('Missing or mismatched immutable VK source snapshot')
          if (!original.normalized) throw Error('Normalized VK message unavailable')
          messages.push({ ...original.raw, text: archiveMessageText(original.normalized) })
        }
        if (archiveChanges.revision() !== revision)
          throw Error('VK archive changed while reading window')
        return { messages, ownerId, peerId, revision }
      },
      false,
      true,
    )
  }
  const readNormalizedFixed = (
    limit = 80,
    afterMessageId?: number,
  ): Promise<readonly ArchiveMessageV1[]> =>
    withFixed(
      async (repo, peerId) => {
        const rows = await repo.listMessages(peerId, limit, afterMessageId),
          messages: ArchiveMessageV1[] = []
        for (const row of rows) {
          const source = await repo.getOriginal(peerId, row.messageId)
          if (!source?.normalized) throw Error('Normalized VK source missing')
          messages.push(source.normalized)
        }
        return messages
      },
      false,
      true,
    )
  async function exportFixed(): Promise<Blob> {
    return withFixed(async (repo, peerId) => {
      const revision = archiveChanges.revision()
      const verify = () => {
        if (currentPeer() !== peerId || archiveChanges.revision() !== revision)
          throw Error('VK archive changed during export')
      }
      let cursor: number | undefined
      let count = 0,
        digest = 'start'
      const encode = async (row: Record<string, unknown>, footer = false) => {
        const line = JSON.stringify(row)
        if (!footer) digest = await archiveSha256Hex(`${digest}\n${line}`)
        return new TextEncoder().encode(`${line}\n`)
      }
      async function* records() {
        yield await encode({
          kind: 'header',
          schema: 'koba-fixed-vk-v1',
          peerId,
          completeness: 'unknown',
          source: 'verified-vk-history',
        })
        while (true) {
          verify()
          const page = await repo.listMessages(peerId, 128, cursor)
          if (!page.length) break
          for (const message of page) {
            verify()
            const original = await repo.getOriginal(peerId, message.messageId)
            if (
              !original ||
              original.ownerId !== repo.scope.ownerId ||
              original.raw.id !== message.messageId ||
              (original.raw.peer_id !== undefined && original.raw.peer_id !== peerId)
            )
              throw Error('Missing or mismatched immutable VK source')
            yield await encode({
              kind: 'message',
              fixed: message,
              snapshot: {
                ...original,
                raw: await encodeArchiveClone(original.raw),
                ...(original.previous
                  ? {
                      previous: await Promise.all(
                        original.previous.map(async (value) => ({
                          ...value,
                          raw: await encodeArchiveClone(value.raw),
                        })),
                      ),
                    }
                  : {}),
              },
            })
            count++
          }
          cursor = page.at(-1)?.messageId
          if (page.length < 128) break
        }
        verify()
        yield await encode({ kind: 'footer', count, digest }, true)
      }
      const result = await createGzipFromChunks(records())
      verify()
      return result
    })
  }

  async function exportUserConversation(
    options: VkUserExportOptions,
    onProgress?: (progress: VkExportProgress) => void,
  ) {
    options = {
      ...options,
      downloadedMedia: options.downloadedMedia?.map((candidate) => ({ ...candidate })),
      messageIds: options.messageIds && [...options.messageIds],
    }
    let release: () => void = () => {
      throw Error('VK export context unavailable')
    }
    const result = await withFixed(async (repo, peerId) => {
      const revision = archiveChanges.revision()
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision)
        throw Error('VK archive changed before export selection was prepared')
      release = () => {
        options.signal?.throwIfAborted()
        if (state.disposed || currentPeer() !== peerId || archiveChanges.revision() !== revision)
          throw Error('VK conversation or archive changed during export')
      }
      const downloadedMedia = options.includeMedia
        ? (options.downloadedMedia ?? []).map((candidate) => {
            const receipt = mediaReceipts.get(candidate.key)
            if (
              !receipt ||
              receipt.ownerId !== repo.scope.ownerId ||
              receipt.peerId !== peerId ||
              receipt.revision !== revision ||
              receipt.blob !== candidate.blob
            )
              throw Error('VK attachment receipt is not from the current owner and session')
            return receipt
          })
        : []
      return createVkUserExport(
        repo,
        peerId,
        { ...options, downloadedMedia },
        release,
        onProgress,
        await coverage(repo, peerId),
      )
    })
    release()
    return result
  }
  async function exportUserZip(
    options: VkUserExportOptions,
    onProgress?: (progress: VkExportProgress) => void,
  ): Promise<Blob> {
    return (await exportUserConversation({ ...options, packaging: 'zip' }, onProgress)).blob
  }
  return {
    disposeReader,
    downloadAttachmentFixed,
    resolveParticipants,
    countFixed,
    readFixed,
    readWindowFixed,
    readNormalizedFixed,
    exportFixed,
    exportUserZip,
    exportUserConversation,
    coverageFixed,
    rangeFixed,
    timelineFixed,
  }
}
