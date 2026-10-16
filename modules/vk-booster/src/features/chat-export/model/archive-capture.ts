import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkArchiveSession } from './archive-session'
import { sameVkSourceValue } from './source-value'
/** VK source paging and immutable persistence; no file-folder or UI lifecycle. */
export function createVkArchiveCapture(session: VkArchiveSession) {
  const {
    state,
    cfg,
    currentPeer,
    auth,
    history,
    openFixedArchive,
    verifyOwner,
    progress,
    sleep,
    refresh,
    archiveChanges,
  } = session
  async function captureFixed(limit: number | 'all' = 100): Promise<{
    saved: number
    alreadySaved: number
    available: number
    complete: boolean
    attachmentReferences: number
  }> {
    if (limit !== 'all' && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000))
      throw Error('Dexie capture count must be 1–100000 or all')
    const peerId = currentPeer()
    if (!peerId || state.busy || state.backupRunning || state.disposed)
      throw Error('Select one VK conversation before saving')
    cfg.peerId = peerId
    state.busy = true
    state.stopRequested = false
    session.setCaptureEvidence(undefined)
    progress('Dexie: подготовка', 0, limit === 'all' ? 0 : limit)
    let repo: FixedVkDexieRepository | undefined
    let saved = 0,
      alreadySaved = 0,
      available = 0,
      processed = 0,
      attachmentReferences = 0
    let stableCount: number | undefined
    let changedCount = false
    let finished = false
    let newestId: number | null = null,
      oldestId: number | null = null,
      previousId: number | undefined
    try {
      if (!(await auth())) throw Error('VK API authorization unavailable')
      repo = await openFixedArchive(peerId)
      let offset = 0
      while (!state.stopRequested) {
        if (currentPeer() !== peerId) throw Error('VK peer changed during Dexie capture')
        const requestSize = Math.min(cfg.pageSize, limit === 'all' ? 100 : limit - offset)
        if (requestSize <= 0) {
          finished = true
          break
        }
        const page = await history(offset, requestSize)
        if (currentPeer() !== peerId) throw Error('VK peer changed during Dexie capture')
        if (stableCount !== undefined && page.count !== stableCount) changedCount = true
        stableCount = page.count
        available = page.count
        if (!page.items.length) {
          if (offset < Math.min(page.count, limit === 'all' ? page.count : limit))
            throw Error('VK stopped returning history before the reported total; saved rows retained')
          finished = true
          break
        }
        for (const item of page.items) {
          if (state.stopRequested || currentPeer() !== peerId) break
          if (item.peer_id !== undefined && item.peer_id !== peerId)
            throw Error('VK source returned a different conversation')
          // VK returns newest-first. Repeated/overlapping pages must never count
          // twice toward completeness, while nonadjacent IDs are perfectly valid.
          if (
            !Number.isSafeInteger(item.id) ||
            item.id <= 0 ||
            (previousId !== undefined && item.id >= previousId)
          )
            throw Error('VK history order changed during capture')
          newestId ??= item.id
          oldestId = item.id
          previousId = item.id
          attachmentReferences += Array.isArray(item.attachments) ? item.attachments.length : 0
          const previous = await repo.getOriginal(peerId, item.id)
          if (state.stopRequested || currentPeer() !== peerId) break
          if (previous) {
            if (!sameVkSourceValue(previous.raw, item))
              throw Error('VK message changed: explicit source revision required')
            alreadySaved++
          } else {
            await repo.addOriginal(peerId, item, 'vk-history-current', Date.now())
            saved++
          }
          processed++
        }
        offset += page.items.length
        if (saved) archiveChanges.publish()
        if (!Number.isSafeInteger(offset)) throw Error('VK history offset exceeded safe integer range')
        const target = Math.min(page.count, limit === 'all' ? page.count : limit)
        progress('Dexie: сообщения', Math.min(offset, target), target, {
          newCount: saved,
          scanned: processed,
          attachmentReferences,
        })
        if (offset >= target) {
          finished = true
          break
        }
        await sleep(Math.max(300, cfg.delay))
      }
      if (currentPeer() !== peerId) throw Error('VK peer changed before capture completion')
      if (!repo.scope.ownerId) throw Error('Verified VK owner unavailable')
      await verifyOwner(repo.scope.ownerId, peerId)
      // A shifting source count is a partial snapshot even when all requested offsets were scanned.
      const complete =
        !state.stopRequested &&
        finished &&
        !changedCount &&
        (limit === 'all' ? processed >= available : limit >= available && processed >= available)
      session.setCaptureEvidence({
        peerId,
        ownerId: repo.scope.ownerId,
        archiveRevision: archiveChanges.revision(),
        reportedCount: available,
        firstId: oldestId,
        lastId: newestId,
        startReached: complete,
        endReached: processed > 0 || available === 0,
        countStable: !changedCount,
        observedAtMs: Date.now(),
      })
      progress(
        state.stopRequested ? 'Dexie: остановлено' : complete ? 'Dexie: сохранено' : 'Dexie: частично',
        processed,
        Math.min(available, limit === 'all' ? available : limit),
        {
          newCount: saved,
          scanned: processed,
          attachmentReferences,
        },
      )
      return { saved, alreadySaved, available, complete, attachmentReferences }
    } catch (error) {
      progress('Dexie: ошибка', processed, Math.min(available, limit === 'all' ? available : limit), {
        newCount: saved,
        scanned: processed,
        attachmentReferences,
      })
      throw error
    } finally {
      repo?.close()
      state.busy = false
      refresh()
    }
  }
  return { captureFixed }
}
