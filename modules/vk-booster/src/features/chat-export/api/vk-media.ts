import { readArchiveMedia } from '@kobaproduction/browser-archive'
import type { VkArchiveMeta, VkAsset, VkMediaChoice, VkMessage } from '../model/types'

type JsonRecord = Record<string, unknown>
const record = (v: unknown): JsonRecord =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : {}
const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const number = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function safe(value: unknown): string {
  const raw = String(value || 'file')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
    .replace(/^\.+/, '_')
    .trim()
  let out = '',
    n = 0
  for (const ch of raw) {
    const m = new TextEncoder().encode(ch).length
    if (n + m > 150) break
    out += ch
    n += m
  }
  return out || 'file'
}
const ext = (s: unknown, fallback = 'bin'): string =>
  String(s || fallback)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase() || fallback
const join = (...parts: string[]): string => parts.join('/')

export function assets(message: VkMessage): VkAsset[] {
  const out: VkAsset[] = []
  function descend(n: VkMessage, ctx: string, depth: number): void {
    if (depth > 8) return
    for (const [i, att] of (n.attachments || []).entries()) {
      const type = att.type || 'unknown'
      const v = record(att[type]),
        key = [message.id, ctx, i, type].join(':')
      const choices: VkMediaChoice[] = []
      const add = (url: unknown, name: string, size: unknown = null): void => {
        if (typeof url === 'string' && /^https?:\/\//i.test(url))
          choices.push({ url, name: safe(name), size: number(size) })
      }
      if (type === 'doc' && (record(v.preview).audio_msg || v.type === 5)) {
        const a = record(record(v.preview).audio_msg)
        add(a.link_ogg, 'Голосовое.ogg')
        add(a.link_mp3, 'Голосовое.mp3')
        if (!choices.length) add(v.url, 'Голосовое.' + ext(v.ext, 'ogg'), v.size)
      } else if (type === 'doc') {
        const title = text(v.title),
          extension = ext(v.ext)
        add(
          v.url,
          safe(title || 'Документ') +
            (title.toLowerCase().endsWith('.' + extension) ? '' : '.' + extension),
          v.size,
        )
      } else if (type === 'photo') {
        const sizes = items(v.sizes)
          .map(record)
          .filter((s) => text(s.url))
          .sort(
            (a, b) =>
              (number(b.width) || 0) * (number(b.height) || 0) -
              (number(a.width) || 0) * (number(a.height) || 0),
          )
        const url = text(sizes[0]?.url)
        add(url, 'Фото.' + ext(url.split('?')[0]?.match(/\.([a-z0-9]{3,4})$/i)?.[1], 'jpg'))
      } else if (type === 'audio_message') {
        add(v.link_ogg, 'Голосовое.ogg')
        add(v.link_mp3, 'Голосовое.mp3')
      } else if (type === 'audio') add(v.url, 'Аудио.mp3')
      else if (type === 'graffiti') add(v.url, 'Граффити.png')
      else if (type === 'sticker') {
        const images = items(v.images_with_background || v.images).map(record)
        add(images.at(-1)?.url, 'Стикер.png')
      } else if (type === 'video') {
        const files = Object.entries(record(v.files))
          .filter(([k, url]) => /^mp4_\d+$/.test(k) && typeof url === 'string')
          .sort(([a], [b]) => parseInt(b.slice(4)) - parseInt(a.slice(4)))
        add(files[0]?.[1], 'Видео.mp4')
      }
      out.push({
        key,
        rootId: message.id,
        type,
        choices,
        sourceId: n.id ?? null,
        context: ctx,
        external: type === 'link' && /^https?:\/\//i.test(text(v.url)) ? text(v.url) : null,
        transcript:
          type === 'audio_message'
            ? text(v.transcript) || null
            : type === 'doc'
              ? text(record(record(v.preview).audio_msg).transcript) || null
              : null,
      })
    }
    if (n.reply_message) descend(n.reply_message, ctx + '.reply', depth + 1)
    for (const [i, f] of (n.fwd_messages || []).entries()) descend(f, ctx + '.fwd' + i, depth + 1)
  }
  descend(message, 'root', 0)
  return out
}
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
      if (file.size === prev.size) return 'existing'
    } catch {
      verifyContext()
      /* stale file: redownload */
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
            ? candidate.name.slice(0, dot) + ' (' + index++ + ')' + candidate.name.slice(dot)
            : candidate.name + ' (' + index++ + ')'
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
