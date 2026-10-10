import type { ConversationArchiveEventDetail } from '@chatgpt-booster/observer'
import type { Source } from './archive-v4-entities'
import { identity, sourceObject } from './archive-v4-identities'
import { canonicalSourceJson } from './archive-v4-write'

/** Strict native source normalization/dedup before async fingerprinting or DB open. */
export function collectArchiveSourceRecords(
  detail: ConversationArchiveEventDetail,
  shouldCapture: (message: Readonly<Source>) => boolean,
): {
  records: { raw: Source; canonical: string; capture: boolean; fingerprint: string }[]
  receivedCount: number
  uniqueCount: number
} {
  const received = (detail.payload.messages as unknown[]).map(sourceObject)
  const seen = new Map<string, string>()
  const allRecords: { raw: Source; canonical: string; capture: boolean; fingerprint: string }[] = []
  for (const raw of received) {
    const messageId = identity(raw.id as string, 'messageId')
    if (
      raw.create_time !== null &&
      (typeof raw.create_time !== 'number' || !Number.isFinite(raw.create_time))
    )
      throw new Error('archive.error.incompatibleSource')
    const canonical = canonicalSourceJson(raw)
    const previous = seen.get(messageId)
    if (previous !== undefined && previous !== canonical)
      throw new Error('archive.error.sourceChanged')
    if (previous === undefined)
      allRecords.push({ raw, canonical, capture: shouldCapture(raw), fingerprint: '' })
    seen.set(messageId, canonical)
  }
  return { records: allRecords, receivedCount: received.length, uniqueCount: seen.size }
}
