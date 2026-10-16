/** Retained source adapter for synthetic folder tests; never imported by the active service. */
import { createVkProvider } from '../../api/vk-provider'
import type { ArchiveOptions, LegacyVkArchive, VkMessage } from '../types'
export function createLegacyVkProvider(
  cfg: ArchiveOptions,
  ports: { sleep(ms: number): Promise<void>; refresh(): void },
): ReturnType<typeof createVkProvider> {
  const native = createVkProvider(cfg, ports)
  return {
    ...native,
    async auth() {
      if (await native.auth()) return true
      const legacy = globalThis.VKArchive
      return legacy?.state().authenticated === true && legacy.state().peer_id === cfg.peerId
    },
    async history(offset, count) {
      if (native.hasToken()) return native.history(offset, count)
      const legacy: LegacyVkArchive | undefined = globalThis.VKArchive
      if (!legacy?.state().authenticated) throw Error('Не найдена авторизация VK')
      const from = '1970-01-01',
        through = '2099-12-31'
      let chunk: ReturnType<LegacyVkArchive['getPart']> | undefined
      try {
        chunk = legacy.getPart(from, through)
      } catch {}
      while ((chunk?.next_offset || 0) < offset + count && !chunk?.complete) {
        const before = chunk?.next_offset || 0
        await legacy.captureRange({
          from,
          through,
          maxPages: 1,
          pageSize: Math.min(100, count),
          delayMs: 450,
        })
        chunk = legacy.getPart(from, through)
        if (chunk.next_offset <= before) break
      }
      const all: VkMessage[] = [...(chunk?.messages || [])].sort(
        (a, b) => b.date - a.date || b.id - a.id,
      )
      return { items: all.slice(offset, offset + count), count: chunk?.conversation_total || all.length }
    },
  }
}
