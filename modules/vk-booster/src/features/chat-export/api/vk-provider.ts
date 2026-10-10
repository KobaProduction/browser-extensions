import type { ArchiveOptions, LegacyVkArchive, VkHistoryResponse, VkMessage } from '../model/types'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
function isHistory(value: unknown): value is VkHistoryResponse {
  const r = record(value)
  return (
    !!r &&
    Number.isSafeInteger(r.count) &&
    typeof r.count === 'number' &&
    r.count >= 0 &&
    Array.isArray(r.items) &&
    r.items.every((item: unknown) => {
      const row = record(item)
      return (
        row && Number.isSafeInteger(row.id) && typeof row.date === 'number' && Number.isFinite(row.date)
      )
    })
  )
}
export function createVkProvider(
  cfg: ArchiveOptions,
  { sleep, refresh }: { sleep(ms: number): Promise<void>; refresh(): void },
): {
  auth(): Promise<boolean>
  history(offset: number, count: number): Promise<VkHistoryResponse>
  api(method: string, params: Record<string, string | number>): Promise<unknown>
  hasToken(): boolean
} {
  let token = ''
  function vkTokens(): string[] {
    const result: string[] = [],
      seen = new Set<string>()
    const add = (value: unknown): void => {
      if (typeof value === 'string' && value.length >= 16 && value.length < 4096 && !seen.has(value)) {
        seen.add(value)
        result.push(value)
      }
    }
    const dive = (value: unknown, depth = 0): void => {
      const obj = record(value)
      if (!obj || depth > 4) return
      for (const [key, child] of Object.entries(obj).slice(0, 100)) {
        if (/^(access_?token|vk_?access_?token|oauth_?token|token)$/i.test(key)) add(child)
        else if (record(child)) dive(child, depth + 1)
      }
    }
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
      try {
        for (let i = 0; i < Math.min(store?.length || 0, 400); i++) {
          const key = store.key(i)
          if (!key || !/auth|oauth|token|session|vk/i.test(key)) continue
          const value = store.getItem(key)
          if (!value || value.length > 300000) continue
          if (/token/i.test(key) && !value.startsWith('{')) add(value)
          try {
            dive(JSON.parse(value))
          } catch {
            /* value was not JSON */
          }
        }
      } catch {
        /* browser storage unavailable */
      }
    }
    return result.slice(0, 8)
  }
  async function api(
    method: string,
    params: Record<string, string | number>,
    attempt = 0,
  ): Promise<unknown> {
    const body = new URLSearchParams(
      Object.entries({ ...params, access_token: token }).map(([key, value]) => [key, String(value)]),
    )
    const resp = await fetch('https://web.api.vk.ru/method/' + method + '?v=5.289&client_id=6287487', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(25000),
    })
    if ((resp.status === 429 || resp.status >= 500) && attempt < 2) {
      await sleep(1000 * (attempt + 1))
      return api(method, params, attempt + 1)
    }
    if (!resp.ok) throw Error('VK HTTP ' + resp.status)
    const data: unknown = await resp.json(),
      obj = record(data)
    if (obj?.error) {
      const error = record(obj.error)
      throw Error('VK API ' + String(error?.error_code ?? 'unknown'))
    }
    return obj?.response
  }
  async function auth(): Promise<boolean> {
    if (token) return true
    for (const candidate of vkTokens()) {
      try {
        token = candidate
        const result = await api('messages.getHistory', {
          peer_id: cfg.peerId,
          count: 1,
          offset: 0,
          rev: 0,
        })
        if (isHistory(result)) {
          refresh()
          return true
        }
      } catch {
        /* try next known token */
      }
    }
    token = ''
    const legacy = globalThis.VKArchive
    if (legacy?.state().authenticated && legacy.state().peer_id === cfg.peerId) return true
    refresh()
    return false
  }
  async function history(offset: number, count: number): Promise<VkHistoryResponse> {
    if (token) {
      const value = await api('messages.getHistory', { peer_id: cfg.peerId, count, offset, rev: 0 })
      if (!isHistory(value)) throw Error('Неверный ответ истории')
      return value
    }
    const legacy: LegacyVkArchive | undefined = globalThis.VKArchive
    if (!legacy?.state().authenticated) throw Error('Не найдена авторизация VK')
    const from = '1970-01-01',
      through = '2099-12-31'
    let chunk: ReturnType<LegacyVkArchive['getPart']> | undefined
    try {
      chunk = legacy.getPart(from, through)
    } catch {
      /* history not initialized */
    }
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
    const all: VkMessage[] = [...(chunk?.messages || [])].sort((a, b) => b.date - a.date || b.id - a.id)
    return { items: all.slice(offset, offset + count), count: chunk?.conversation_total || all.length }
  }
  return { auth, history, api, hasToken: () => Boolean(token) }
}
