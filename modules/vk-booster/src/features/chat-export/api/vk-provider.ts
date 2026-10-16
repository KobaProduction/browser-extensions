import type { ArchiveOptions, VkHistoryResponse } from '../model/types'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
/** VK may allow a token to read a dialog yet reject users.get.
 * Never accept it for an owner-scoped Dexie archive without both permissions. */
function hasVerifiedOwner(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length) return false
  const first = record(value[0])
  return !!first && typeof first.id === 'number' && Number.isSafeInteger(first.id) && first.id > 0
}
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
  destroy(): void
} {
  let token = ''
  let disposed = false
  const pending = new Set<AbortController>()
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
    if (disposed) throw Error('VK provider is stopped')
    const body = new URLSearchParams(
      Object.entries({ ...params, access_token: token }).map(([key, value]) => [key, String(value)]),
    )
    const request = new AbortController()
    const timeout = setTimeout(() => request.abort(), 25000)
    pending.add(request)
    try {
      const resp = await fetch(`https://web.api.vk.ru/method/${method}?v=5.289&client_id=6287487`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: request.signal,
      })
      if (disposed) throw Error('VK provider is stopped')
      if ((resp.status === 429 || resp.status >= 500) && attempt < 4) {
        await sleep(Math.min(12000, 1000 * 2 ** attempt))
        return api(method, params, attempt + 1)
      }
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) token = ''
        throw Error(`VK HTTP ${resp.status}`)
      }
      const data: unknown = await resp.json(),
        obj = record(data)
      if (disposed) throw Error('VK provider is stopped')
      if (obj?.error) {
        const error = record(obj.error)
        // VK code 6 explicitly asks clients to slow down. Retry a bounded number of times.
        if (error?.error_code === 6 && attempt < 4) {
          await sleep(Math.min(12000, 1000 * 2 ** attempt))
          return api(method, params, attempt + 1)
        }
        if (error?.error_code === 5 || error?.error_code === 1116) token = ''
        throw Error(`VK API ${String(error?.error_code ?? 'unknown')}`)
      }
      return obj?.response
    } finally {
      clearTimeout(timeout)
      pending.delete(request)
    }
  }
  async function auth(): Promise<boolean> {
    if (disposed) return false
    if (token) return true
    for (const candidate of vkTokens()) {
      if (disposed) return false
      try {
        token = candidate
        // Owner verification is independent of a selected conversation. History
        // permissions are checked by the actual capture request before writes.
        if (hasVerifiedOwner(await api('users.get', {})) && !disposed) {
          refresh()
          return true
        }
      } catch {
        /* try next known token */
      }
    }
    token = ''
    refresh()
    return false
  }
  async function history(offset: number, count: number): Promise<VkHistoryResponse> {
    if (token) {
      const value = await api('messages.getHistory', { peer_id: cfg.peerId, count, offset, rev: 0 })
      if (!isHistory(value)) throw Error('Неверный ответ истории')
      return value
    }
    throw Error('Не найдена подтверждённая авторизация VK')
  }
  return {
    auth,
    history,
    api,
    hasToken: () => !disposed && Boolean(token),
    destroy() {
      disposed = true
      token = ''
      for (const request of pending) request.abort()
      pending.clear()
    },
  }
}
