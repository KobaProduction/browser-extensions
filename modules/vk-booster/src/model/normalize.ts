import type { VkAttachment, VkMessage } from './types'

type RecordJson = Record<string, unknown>
const obj = (value: unknown): RecordJson =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordJson) : {}
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null
function attachmentName(type: string, source: RecordJson): string {
  const title = typeof source.title === 'string' && source.title.trim() ? source.title : null
  if (title) return title
  const name = typeof source.name === 'string' && source.name.trim() ? source.name : null
  if (name) return name
  const extension =
    type === 'photo'
      ? 'jpg'
      : type === 'audio_message'
        ? 'ogg'
        : type === 'video'
          ? 'mp4'
          : type === 'sticker'
            ? 'png'
            : 'bin'
  return type + '.' + extension
}
/** Keep only data required for archive presentation and attachment resolution.
 * No raw provider DTO, URL query, cookie or access token enters IndexedDB. */
export function normalizeVkMessage(raw: unknown, peerId: number): VkMessage {
  const row = obj(raw)
  const id = int(row.id)
  const date = int(row.date)
  if (!id || !date || id < 1 || date < 1) throw Error('VK supplied invalid message identity')
  const attachments: VkAttachment[] = (Array.isArray(row.attachments) ? row.attachments : []).map(
    (entry: unknown, index: number) => {
      const a = obj(entry)
      const type = typeof a.type === 'string' && /^[a-z_]+$/i.test(a.type) ? a.type : 'unknown'
      const data = obj(a[type])
      return {
        id: [peerId, id, index, type].join(':'),
        peerId,
        messageId: id,
        index,
        type,
        originalName: attachmentName(type, data),
        sourceId: int(data.id),
        byteSize: int(data.size),
      }
    },
  )
  return {
    peerId,
    id,
    date,
    fromId: int(row.from_id),
    out: row.out === 1 || row.out === true,
    text: typeof row.text === 'string' ? row.text : '',
    attachments,
  }
}
export function withinDates(dateSeconds: number, from: string, through: string): boolean {
  const day = new Date(dateSeconds * 1000).toISOString().slice(0, 10)
  return (!from || day >= from) && (!through || day <= through)
}
