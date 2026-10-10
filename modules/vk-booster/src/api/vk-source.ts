import { normalizeVkMessage } from '../model/normalize'
import type { VkAttachment, VkMessageSource } from '../model/types'

type Json = Record<string, unknown>
const object = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
/** VK API stays outside domain. Tokens are ephemeral and never enter archives. */
export function createVkSource(
  fetcher: typeof fetch = fetch,
  local: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
  session: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
): VkMessageSource {
  let token: string | null = null
  const candidates = (): string[] => {
    const all = new Set<string>()
    for (const storage of [local, session]) {
      try {
        if (!storage) continue
        for (let i = 0; i < Math.min(storage.length, 400); i++) {
          const k = storage.key(i)
          if (!k || !/token|oauth|session|vk|auth/i.test(k)) continue
          const raw = storage.getItem(k)
          if (!raw || raw.length > 200000) continue
          if (/token/i.test(k) && !raw.startsWith('{') && raw.length >= 16) all.add(raw)
          try {
            const q = JSON.parse(raw) as unknown
            const find = (v: unknown, depth: number): void => {
              if (depth > 4 || !v || typeof v !== 'object' || Array.isArray(v)) return
              for (const [key, x] of Object.entries(v as Json).slice(0, 100))
                if (/^(access_?token|vk_?access_?token|oauth_?token|token)$/i.test(key)) {
                  if (typeof x === 'string' && x.length >= 16 && x.length < 4096) all.add(x)
                } else find(x, depth + 1)
            }
            find(q, 0)
          } catch {
            /* Non-JSON origin storage is not a credential proof. */
          }
        }
      } catch {
        /* No permission to read this origin storage. */
      }
    }
    return [...all].slice(0, 8)
  }
  async function call(
    method: string,
    params: Record<string, string | number>,
    candidate: string,
  ): Promise<unknown> {
    const body = new URLSearchParams(
      Object.entries({ ...params, access_token: candidate }).map(([key, value]) => [key, String(value)]),
    )
    const response = await fetcher(
      'https://web.api.vk.ru/method/' + method + '?v=5.289&client_id=6287487',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(25000),
      },
    )
    if (!response.ok) throw Error('VK history HTTP ' + response.status)
    const answer = object(await response.json())
    if (answer.error) throw Error('VK API refused method ' + method)
    return answer.response
  }
  async function api(method: string, params: Record<string, string | number>): Promise<unknown> {
    if (token) return call(method, params, token)
    for (const candidate of candidates()) {
      try {
        const response = await call(method, params, candidate)
        token = candidate
        return response
      } catch {
        /* No verified authorized candidate; try the next one. */
      }
    }
    throw Error('VK API authorization unavailable; open an authenticated VK conversation')
  }
  const history: VkMessageSource['history'] = async (peerId, offset, pageSize) => {
    const response = object(
      await api('messages.getHistory', {
        peer_id: peerId,
        offset,
        count: Math.min(100, Math.max(1, pageSize)),
        rev: 0,
      }),
    )
    const rows = response.items
    if (
      !Array.isArray(rows) ||
      !Number.isSafeInteger(response.count) ||
      typeof response.count !== 'number' ||
      response.count < 0
    )
      throw Error('Invalid VK history response')
    return { total: response.count, messages: rows.map((x) => normalizeVkMessage(x, peerId)) }
  }
  const attachmentBytes: NonNullable<VkMessageSource['attachmentBytes']> = async (
    item: VkAttachment,
  ) => {
    // Refresh expiring CDN URLs from the source, never from archived auth-bearing DTOs.
    const reply = object(await api('messages.getById', { message_ids: item.messageId, extended: 0 }))
    const message = (Array.isArray(reply.items) ? reply.items : [])[0]
    const entries = object(message).attachments
    const att = Array.isArray(entries) ? object(entries[item.index]) : {}
    if (att.type !== item.type) throw Error('Source attachment changed or is inaccessible')
    const resource = object(att[item.type])
    const urls: string[] = []
    const append = (v: unknown): void => {
      if (typeof v === 'string' && /^https:\/\//i.test(v)) urls.push(v)
    }
    if (item.type === 'photo') {
      const sizes = Array.isArray(resource.sizes) ? resource.sizes.map(object) : []
      sizes.sort(
        (a, b) =>
          Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0),
      )
      append(sizes[0]?.url)
    } else if (item.type === 'audio_message') {
      append(resource.link_ogg)
      append(resource.link_mp3)
    } else if (item.type === 'video') {
      const files = object(resource.files)
      const urlsBySize = Object.keys(files)
        .filter((k) => /^mp4_\d+$/.test(k))
        .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)))
      append(files[urlsBySize[0] || ''])
    } else if (item.type === 'sticker') {
      const pics = Array.isArray(resource.images) ? resource.images : []
      append(object(pics.at(-1)).url)
    } else append(resource.url)
    for (const url of urls) {
      try {
        const resp = await fetcher(url, { credentials: 'omit', signal: AbortSignal.timeout(60000) })
        if (!resp.ok) continue
        if (Number(resp.headers.get('content-length') || 0) > 64 * 1048576)
          throw Error('Attachment exceeds size limit')
        const reader = resp.body?.getReader()
        if (!reader) throw Error('Missing attachment body')
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          for (;;) {
            const x = await reader.read()
            if (x.done) break
            length += x.value.byteLength
            if (length > 64 * 1048576) throw Error('Attachment exceeds size limit')
            chunks.push(x.value)
          }
        } finally {
          reader.releaseLock()
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const c of chunks) {
          bytes.set(c, offset)
          offset += c.length
        }
        return bytes
      } catch {
        /* Candidate CDN URL may have expired; next verified variant. */
      }
    }
    throw Error('File is not available from VK; original reference was retained')
  }
  return { history, attachmentBytes }
}
