import { readArchiveMedia } from '@kobaproduction/browser-archive'
import type { VkAsset, VkDownloadedAttachment } from '../model/types'

/** Explicit user action only. The caller resolves the asset from an owned saved snapshot. */
export async function downloadVkAttachment(
  asset: VkAsset,
  options: {
    signal: AbortSignal
    assertCurrent(): Promise<void>
    maxBytes?: number
    fetcher?: (url: string, init: RequestInit) => Promise<Response>
  },
): Promise<VkDownloadedAttachment> {
  for (const choice of asset.choices) {
    options.signal.throwIfAborted()
    let url: URL
    try {
      url = new URL(choice.url)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.username || url.password || /[\p{Cc}]/u.test(choice.url))
      continue
    await options.assertCurrent()
    let response: Response | undefined
    try {
      response = await (options.fetcher ?? fetch)(url.href, {
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: options.signal,
      })
      await options.assertCurrent()
      const result = await readArchiveMedia(response, {
        maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
        expectedBytes: choice.size,
      })
      await options.assertCurrent()
      if (['photo', 'sticker', 'graffiti'].includes(asset.type)) {
        const bytes = result.bytes
        const signature = new TextDecoder().decode(bytes.subarray(0, 16))
        const valid =
          (result.mime === 'image/png' &&
            [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) ||
          (result.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
          (result.mime === 'image/gif' && /^GIF8[79]a/.test(signature)) ||
          (result.mime === 'image/webp' &&
            signature.startsWith('RIFF') &&
            signature.slice(8, 12) === 'WEBP') ||
          (result.mime === 'image/avif' &&
            signature.slice(4, 8) === 'ftyp' &&
            /avif|avis/.test(signature.slice(8)))
        if (!valid) throw Error('VK image MIME or binary signature mismatch')
      }
      return {
        key: asset.key,
        name: choice.name,
        blob: new Blob([result.bytes], { type: result.mime }),
        size: result.size,
        sha256: result.sha256,
        mime: result.mime,
      }
    } catch {
      await response?.body?.cancel().catch(() => undefined)
      options.signal.throwIfAborted()
      await options.assertCurrent()
      // Only declared source alternatives may be retried; no URL guessing or secret diagnostics.
    }
  }
  throw Error('VK attachment unavailable or unsafe')
}
