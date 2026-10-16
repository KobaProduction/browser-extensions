import { readArchiveMedia } from '@kobaproduction/browser-archive'
import type { VkArchiveMeta, VkAsset } from '../types'

const join = (...parts: string[]): string => parts.join('/')
export interface MediaDownloadContext {
  meta: VkArchiveMeta
  dir(name: string, parent?: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle>
  write(name: string, data: unknown, parent?: FileSystemDirectoryHandle): Promise<void>
  sleep(ms: number): Promise<void>
  // VK owns the live route/peer contract. Recheck it across async media boundaries.
  verifyContext(): void
}
export type MediaDownloadResult = 'saved' | 'existing' | 'failed' | 'link' | 'unavailable'
export async function download(
  asset: VkAsset,
  { meta, dir, write, sleep, verifyContext }: MediaDownloadContext,
): Promise<MediaDownloadResult> {
  verifyContext()
  const prev = meta.files[asset.key]
  if (prev?.status === 'saved' && prev.name) {
    try {
      const target = await dir(String(asset.rootId), await dir('media'))
      verifyContext()
      const file = await (await target.getFileHandle(prev.name)).getFile()
      verifyContext()
      if (file.size === prev.size) {
        // Earlier file receipts may not contain hashes: retain legacy size-only
        // compatibility rather than rewriting unknown offline media.
        if (!prev.sha256) return 'existing'
        // The downloader never writes more than 64 MiB. Bound the read before
        // computing a digest, so corrupted metadata cannot force an unbounded load.
        if (file.size > 64 * 1048576) throw Error('Stored media exceeds verification limit')
        if (!/^[0-9a-f]{64}$/.test(prev.sha256))
          throw Error('Stored media receipt contains an invalid SHA-256')
        const buffer = await file.arrayBuffer()
        verifyContext()
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
        verifyContext()
        if (hash === prev.sha256) return 'existing'
      }
    } catch (error) {
      verifyContext()
      // Only a genuinely missing file is safely eligible for retry here.
      // Permission, read and integrity-check failures must not overwrite a
      // previously saved receipt with a speculative download failure.
      if (!(error instanceof Error) || error.name !== 'NotFoundError') throw error
    }
  }
  const result = {
    type: asset.type,
    message_id: asset.rootId,
    source_id: asset.sourceId,
    status: 'unavailable',
  } as VkArchiveMeta['files'][string]
  if (asset.type === 'link') {
    verifyContext()
    result.status = 'link'
    meta.files[asset.key] = result
    return 'link'
  }
  let failures = 0
  for (const candidate of asset.choices) {
    try {
      verifyContext()
      const response = await fetch(candidate.url, {
        method: 'GET',
        credentials: 'omit',
        signal: AbortSignal.timeout(60000),
      })
      verifyContext()
      const payload = await readArchiveMedia(response, {
        maxBytes: 64 * 1048576,
        expectedBytes: candidate.size,
      })
      verifyContext()
      const media = await dir(String(asset.rootId), await dir('media'))
      verifyContext()
      let name = candidate.name,
        index = 2
      const occupied = new Set(
        Object.entries(meta.files)
          .filter(
            ([key, file]) =>
              key !== asset.key && file.message_id === asset.rootId && file.status === 'saved',
          )
          .map(([, file]) => file.name),
      )
      while (occupied.has(name)) {
        const dot = candidate.name.lastIndexOf('.')
        name =
          dot > 0
            ? `${candidate.name.slice(0, dot)} (${index++})${candidate.name.slice(dot)}`
            : `${candidate.name} (${index++})`
      }
      verifyContext()
      await write(name, payload.bytes, media)
      verifyContext()
      Object.assign(result, {
        status: 'saved',
        name,
        size: payload.size,
        sha256: payload.sha256,
        path: join('media', String(asset.rootId), name),
        mime: payload.mime,
      })
      meta.files[asset.key] = result
      return 'saved'
    } catch {
      // A changed VK conversation is not a failed media candidate. Never
      // retry or mark media failed in the previous conversation's archive.
      verifyContext()
      /* retry next provider media choice */
    }
    failures++
    await sleep(300)
    verifyContext()
  }
  verifyContext()
  if (failures) result.status = 'failed'
  meta.files[asset.key] = result
  return result.status
}
