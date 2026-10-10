import type { CaptureProgress, VkArchiveRepository, VkMessageSource } from './types'
import { validPeerId } from './types'

/** One complete source snapshot. No 'recent N', backfill or unproven completion. */
export function createVkArchiveService(repository: VkArchiveRepository, source: VkMessageSource) {
  let active = false
  return {
    async captureFull(
      peerId: number,
      notify?: (progress: CaptureProgress) => void,
      force = false,
    ): Promise<CaptureProgress> {
      if (!validPeerId(peerId)) throw Error('Select a VK conversation')
      if (active) throw Error('Another archive operation is running')
      const existing = await repository.getConversation(peerId)
      if (existing?.complete && !force)
        return {
          peerId,
          pages: 0,
          seen: existing.messageCount,
          stored: existing.messageCount,
          complete: true,
        }
      active = true
      let offset = 0,
        pages = 0,
        total = Number.POSITIVE_INFINITY
      const collected = new Set<number>()
      let initialTotal: number | null = null
      try {
        while (offset < total) {
          const page = await source.history(peerId, offset, 100)
          if (!Number.isSafeInteger(page.total) || page.total < 0)
            throw Error('VK returned invalid total')
          if (initialTotal !== null && initialTotal !== page.total)
            throw Error('VK history changed during the full capture; retry from start')
          initialTotal ??= page.total
          total = page.total
          if (!page.messages.length && offset < total)
            throw Error('VK returned an incomplete history page')
          if (page.messages.some((m) => m.peerId !== peerId))
            throw Error('VK conversation changed during capture')
          await repository.storePage(peerId, page.messages)
          for (const m of page.messages) collected.add(m.id)
          offset += page.messages.length
          pages++
          notify?.({ peerId, pages, seen: offset, stored: collected.size, complete: false })
          if (pages > 100000) throw Error('VK archive exceeds expected page count')
        }
        if (total === 0 && pages === 0) await repository.storePage(peerId, [])
        if (collected.size !== total)
          throw Error('Full VK snapshot has duplicate or missing message IDs')
        await repository.markComplete(peerId)
        const count = (await repository.getConversation(peerId))?.messageCount ?? 0
        const result = { peerId, pages, seen: offset, stored: count, complete: true }
        notify?.(result)
        return result
      } finally {
        active = false
      }
    },
  }
}
