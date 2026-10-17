import type { FixedVkDexieRepository } from './archive-fixed-dexie'
import type { VkArchiveSession } from './archive-session'
import { sameVkSourceValue } from './source-value'

/** Owner-requested synchronization threshold, not proof that VK metadata is immutable. */
export const VK_EDIT_RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000

/** VK source paging and persistence; DOM rendering never supplies capture facts. */
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
  async function captureFixed(limit: number | 'all' = 100) {
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
    let expectedRevision = archiveChanges.revision()
    let pendingLocalChange = false
    const assertCurrent = () => {
      if (state.disposed || currentPeer() !== peerId) throw Error('VK peer changed during Dexie capture')
      if (archiveChanges.revision() !== expectedRevision)
        throw Error('VK archive changed during capture')
    }
    const publishLocal = () => {
      archiveChanges.publish()
      expectedRevision = archiveChanges.revision()
      pendingLocalChange = false
    }
    let repo: FixedVkDexieRepository | undefined
    let saved = 0,
      alreadySaved = 0,
      updated = 0,
      available = 0,
      processed = 0,
      attachmentReferences = 0,
      reused = 0,
      newerThanBaseline = 0
    let initialCount: number | undefined
    let changedCount = false,
      finished = false
    let newestId: number | null = null,
      oldestId: number | null = null,
      previousId: number | undefined
    const seen = new Set<number>()
    const startedAtMs = Date.now()
    const extra = () => ({ newCount: saved, scanned: processed, updated, reused, attachmentReferences })
    try {
      if (!(await auth())) throw Error('VK API authorization unavailable')
      assertCurrent()
      repo = await openFixedArchive(peerId)
      const baseline = limit === 'all' ? await repo.historyCoverage(peerId) : undefined
      assertCurrent()
      let offset = 0,
        stalledPages = 0
      while (!state.stopRequested) {
        assertCurrent()
        const requestSize = Math.min(cfg.pageSize, limit === 'all' ? 100 : limit - processed)
        if (requestSize <= 0) {
          finished = true
          break
        }
        // Anchor paging to this run's first message so incoming messages cannot shift offsets.
        const page = await history(offset, requestSize, newestId ?? undefined)
        assertCurrent()
        initialCount ??= page.count
        if (page.count !== initialCount) changedCount = true
        available = initialCount
        if (!page.items.length) {
          if (processed < Math.min(available, limit === 'all' ? available : limit))
            throw Error('VK stopped returning history before the reported total; saved rows retained')
          finished = true
          break
        }
        let pageNew = 0,
          pageChanged = false
        for (const item of page.items) {
          if (state.stopRequested) break
          assertCurrent()
          if (item.peer_id !== undefined && item.peer_id !== peerId)
            throw Error('VK source returned a different conversation')
          if (!Number.isSafeInteger(item.id) || item.id <= 0)
            throw Error('Invalid VK history message identity')
          const duplicate = seen.has(item.id)
          if (!duplicate && previousId !== undefined && item.id >= previousId)
            throw Error('VK history order changed during capture')
          const previous = await repo.getOriginal(peerId, item.id)
          assertCurrent()
          if (state.stopRequested) break
          const unchanged = !!previous && sameVkSourceValue(previous.raw, item)
          const outcome = await repo.observeOriginal(
            peerId,
            item,
            'vk-history-current',
            Date.now(),
            assertCurrent,
          )
          pendingLocalChange ||= outcome !== 'unchanged'
          assertCurrent()
          pageChanged ||= outcome !== 'unchanged'
          if (outcome === 'saved') saved++
          if (outcome === 'revised') updated++
          if (duplicate) continue
          seen.add(item.id)
          newestId ??= item.id
          oldestId = previousId = item.id
          processed++
          pageNew++
          if (previous) alreadySaved++
          attachmentReferences += Array.isArray(item.attachments) ? item.attachments.length : 0
          if (baseline && item.id > baseline.lastId) newerThanBaseline++
          // One old saved row is insufficient: only a verified, still-present full tail may be reused.
          if (
            baseline &&
            unchanged &&
            !changedCount &&
            item.id >= baseline.firstId &&
            item.id <= baseline.lastId &&
            Number.isFinite(item.date) &&
            item.date > 0 &&
            startedAtMs - item.date * 1000 > VK_EDIT_RECHECK_WINDOW_MS &&
            available === baseline.count + newerThanBaseline
          ) {
            reused = available - processed
            oldestId = baseline.firstId
            finished = true
            break
          }
          if (processed >= Math.min(available, limit === 'all' ? available : limit)) {
            finished = true
            break
          }
        }
        if (pageChanged) publishLocal()
        const target = Math.min(available, limit === 'all' ? available : limit)
        progress('Dexie: сообщения', processed, target, extra())
        if (finished || state.stopRequested) break
        if (!pageNew) {
          if (++stalledPages >= 3) throw Error('VK history paging made no progress')
        } else stalledPages = 0
        offset += pageNew
        if (!Number.isSafeInteger(offset)) throw Error('VK history offset exceeded safe integer range')
        await sleep(Math.max(300, cfg.delay))
      }
      assertCurrent()
      if (!repo.scope.ownerId) throw Error('Verified VK owner unavailable')
      await verifyOwner(repo.scope.ownerId, peerId)
      assertCurrent()
      // Recheck the unanchored head before advertising a complete current history.
      if (finished && !state.stopRequested && !changedCount && processed + reused >= available) {
        const head = await history(0, 1)
        assertCurrent()
        if (head.count !== available || (head.items[0]?.id ?? null) !== newestId) changedCount = true
      }
      let complete =
        !state.stopRequested &&
        finished &&
        !changedCount &&
        processed + reused >= available &&
        (limit === 'all' || limit >= available)
      if (complete && oldestId !== null && newestId !== null) {
        complete = await repo.recordHistoryCoverage(
          peerId,
          {
            version: 1,
            firstId: oldestId,
            lastId: newestId,
            count: available,
            observedAtMs: Date.now(),
          },
          assertCurrent,
        )
        assertCurrent()
        if (complete) publishLocal()
      } else if (complete && available === 0) {
        complete = (await repo.countMessages(peerId)) === 0
        assertCurrent()
      }
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
        extra(),
      )
      return { saved, alreadySaved, updated, reused, available, complete, attachmentReferences }
    } catch (error) {
      if (pendingLocalChange) publishLocal()
      progress(
        'Dexie: ошибка',
        processed,
        Math.min(available, limit === 'all' ? available : limit),
        extra(),
      )
      throw error
    } finally {
      repo?.close()
      state.busy = false
      refresh()
    }
  }
  return { captureFixed }
}
