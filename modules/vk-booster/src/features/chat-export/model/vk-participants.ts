/** Optional VK display labels; independent of the immutable Dexie v1 schema. */
export interface VkParticipant {
  id: number
  name: string
  avatarUrl: string | null
}
export function verifiedVkParticipants(response: unknown): VkParticipant[] {
  if (!Array.isArray(response)) return []
  return response.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    const id = row.id
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return []
    const first = typeof row.first_name === 'string' ? row.first_name.trim() : ''
    const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
    const name = [first, last].filter(Boolean).join(' ')
    if (!name) return []
    const url =
      typeof row.photo_100 === 'string' && /^https:\/\//i.test(row.photo_100) ? row.photo_100 : null
    return [{ id, name, avatarUrl: url }]
  })
}
