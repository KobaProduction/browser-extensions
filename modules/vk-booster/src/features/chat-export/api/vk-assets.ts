import type { VkAsset, VkMediaChoice, VkMessage } from '../model/types'

type JsonRecord = Record<string, unknown>
const record = (v: unknown): JsonRecord =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : {}
const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const number = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function safe(value: unknown): string {
  const raw = (typeof value === 'string' ? value : 'file')
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
  (typeof s === 'string' && s ? s : fallback).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || fallback

export function inspectVkAssets(message: VkMessage): { assets: VkAsset[]; truncated: boolean } {
  const out: VkAsset[] = []
  let truncated = false
  function descend(n: VkMessage, ctx: string, depth: number): void {
    if (depth > 8) {
      truncated = true
      return
    }
    if (!n || typeof n !== 'object' || Array.isArray(n)) return
    for (const [i, value] of items(n.attachments).entries()) {
      const att = record(value),
        type = text(att.type) || 'unknown'
      const v = Object.hasOwn(att, type) ? record(att[type]) : {},
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
        if (!choices.length) add(v.url, `Голосовое.${ext(v.ext, 'ogg')}`, v.size)
      } else if (type === 'doc') {
        const title = text(v.title),
          extension = ext(v.ext)
        add(
          v.url,
          safe(title || 'Документ') +
            (title.toLowerCase().endsWith(`.${extension}`) ? '' : `.${extension}`),
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
        add(url, `Фото.${ext(url.split('?')[0]?.match(/\.([a-z0-9]{3,4})$/i)?.[1], 'jpg')}`)
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
          .sort(([a], [b]) => parseInt(b.slice(4), 10) - parseInt(a.slice(4), 10))
        add(files[0]?.[1], 'Видео.mp4')
      }
      const wallOwner = number(v.owner_id) ?? number(v.to_id)
      const wallId = number(v.id)
      const wallUrl =
        type === 'wall' &&
        wallOwner !== null &&
        Number.isSafeInteger(wallOwner) &&
        wallOwner !== 0 &&
        wallId !== null &&
        Number.isSafeInteger(wallId) &&
        wallId > 0
          ? `https://vk.ru/wall${wallOwner}_${wallId}`
          : null
      out.push({
        key,
        rootId: message.id,
        type,
        choices,
        sourceId: n.id ?? null,
        context: ctx,
        external: type === 'link' && /^https?:\/\//i.test(text(v.url)) ? text(v.url) : wallUrl,
        transcript:
          type === 'audio_message'
            ? text(v.transcript) || null
            : type === 'doc'
              ? text(record(record(v.preview).audio_msg).transcript) || null
              : null,
      })
      if (type === 'wall') descend(v as unknown as VkMessage, `${ctx}.wall${i}`, depth + 1)
    }
    if (n.reply_message) descend(n.reply_message, `${ctx}.reply`, depth + 1)
    for (const [i, f] of items(n.fwd_messages).entries())
      descend(f as VkMessage, `${ctx}.fwd${i}`, depth + 1)
  }
  descend(message, 'root', 0)
  return { assets: out, truncated }
}
export function assets(message: VkMessage): VkAsset[] {
  return inspectVkAssets(message).assets
}
