import { archiveSha256Hex, encodeArchiveClone } from '@kobaproduction/browser-archive'

/** Source-message reconciliation. Observation time never makes a stale reload newer. */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
class AsynchronousSourceValue extends Error {}

/** Synchronous JSON/projection comparison. Opaque clone values require the codec below. */
export function sourceFingerprint(value: unknown): string {
  const ancestors = new Set<object>()
  const encode = (input: unknown): unknown => {
    if (input === undefined) return ['undefined']
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number')
      return Number.isFinite(input) && !Object.is(input, -0) ? input : ['number', String(input)]
    if (typeof input === 'bigint') return ['bigint', input.toString()]
    if (!input || typeof input !== 'object') throw Error('Unsupported source value')
    if (ancestors.has(input)) throw Error('Source data contains a cycle')
    const prototype = Object.getPrototypeOf(input)
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null)
      throw new AsynchronousSourceValue('Native source value requires lossless asynchronous encoding')
    ancestors.add(input)
    const result = [
      Array.isArray(input) ? 'array' : 'object',
      ...(Array.isArray(input) ? [input.length] : []),
      Object.keys(input)
        .sort()
        .map((key) => [key, encode((input as Record<string, unknown>)[key])]),
    ]
    ancestors.delete(input)
    return result
  }
  return JSON.stringify(encode(value))
}

/** Same lossless native value vocabulary as backup/export, with object key order canonicalized. */
export async function sourceCloneFingerprint(value: unknown): Promise<string> {
  const canonicalize = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node
    const [tag, ...fields] = node
    if (tag === 'object' || tag === 'array') {
      const entries = (tag === 'object' ? fields[0] : fields[1]) as [string, unknown][]
      const canonicalEntries = [...entries]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)])
      return tag === 'object' ? [tag, canonicalEntries] : [tag, fields[0], canonicalEntries]
    }
    if (tag === 'map')
      return [
        tag,
        (fields[0] as [unknown, unknown][]).map(([key, item]) => [
          canonicalize(key),
          canonicalize(item),
        ]),
      ]
    if (tag === 'set') return [tag, (fields[0] as unknown[]).map(canonicalize)]
    return node
  }
  return JSON.stringify(canonicalize(await encodeArchiveClone(value)))
}
export interface SourceCloneDigest {
  hash: string
  length: number
}
/** Retain a bounded digest for duplicate detection, plus the original encoded
 * length needed by the existing observation enrichment policy. */
export async function sourceCloneDigest(value: unknown): Promise<SourceCloneDigest> {
  const fingerprint = await sourceCloneFingerprint(value)
  return { hash: await archiveSha256Hex(fingerprint), length: fingerprint.length }
}
function text(value: Record<string, unknown>): string {
  const content = object(value.content)
  return typeof content?.text === 'string'
    ? content.text
    : Array.isArray(content?.parts)
      ? content.parts.filter((part): part is string => typeof part === 'string').join('\n')
      : ''
}
function time(value: Record<string, unknown>): number {
  const updated = value.update_time ?? value.create_time
  return typeof updated === 'number' && Number.isFinite(updated) ? updated : 0
}
function terminal(value: Record<string, unknown>): boolean {
  return (
    typeof value.status === 'string' &&
    ['finished_successfully', 'complete', 'completed', 'stopped', 'cancelled', 'failed'].includes(
      value.status,
    )
  )
}
function sameSynchronousSourceValue(current: unknown, incoming: unknown): boolean {
  try {
    return sourceFingerprint(current) === sourceFingerprint(incoming)
  } catch (cause) {
    // Optional upstream context may contain clone-native values. A synchronous
    // identity check cannot prove them equal; retain the incoming variant.
    if (cause instanceof AsynchronousSourceValue) return false
    throw cause
  }
}
function losesEvidence(current: unknown, incoming: unknown): boolean {
  if (current === null || current === undefined) return false
  if (incoming === null || incoming === undefined) return true
  if (typeof current === 'string') return typeof incoming !== 'string' || !incoming.startsWith(current)
  if (Array.isArray(current))
    return (
      !Array.isArray(incoming) ||
      current.length > incoming.length ||
      current.some((value, index) => losesEvidence(value, incoming[index]))
    )
  const before = object(current),
    after = object(incoming)
  if (before) return !after || Object.keys(before).some((key) => losesEvidence(before[key], after[key]))
  return false
}
export type ObservationDecision = 'identical' | 'advance' | 'stale' | 'conflict'
export function compareSourceObservation(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fingerprints?: { current: string; incoming: string; currentLength?: number; incomingLength?: number },
): ObservationDecision {
  let beforeFingerprint: string, afterFingerprint: string
  try {
    beforeFingerprint = fingerprints?.current ?? sourceFingerprint(current)
    afterFingerprint = fingerprints?.incoming ?? sourceFingerprint(incoming)
  } catch (cause) {
    // Live synchronous state cannot fully compare native values. Preserve its prior record;
    // the canonical repository performs full lossless comparison asynchronously.
    if (cause instanceof AsynchronousSourceValue) return 'conflict'
    throw cause
  }
  if (beforeFingerprint === afterFingerprint) return 'identical'
  for (const key of ['id', 'channel', 'recipient'])
    if (
      Object.hasOwn(current, key) &&
      Object.hasOwn(incoming, key) &&
      !sameSynchronousSourceValue(current[key], incoming[key])
    )
      return 'conflict'
  const oldAuthor = object(current.author),
    newAuthor = object(incoming.author)
  for (const key of ['role', 'name'])
    if (
      oldAuthor &&
      newAuthor &&
      Object.hasOwn(oldAuthor, key) &&
      Object.hasOwn(newAuthor, key) &&
      oldAuthor[key] !== newAuthor[key]
    )
      return 'conflict'
  const oldMetadata = object(current.metadata),
    newMetadata = object(incoming.metadata)
  for (const key of ['parent_id', 'turn_exchange_id', 'working_turn_id', 'request_id'])
    if (
      oldMetadata &&
      newMetadata &&
      Object.hasOwn(oldMetadata, key) &&
      Object.hasOwn(newMetadata, key) &&
      oldMetadata[key] !== newMetadata[key]
    )
      return 'conflict'
  if (time(incoming) < time(current) || (terminal(current) && !terminal(incoming))) return 'stale'
  const before = text(current),
    after = text(incoming)
  if (before && (after.length < before.length || !after.startsWith(before))) return 'conflict'
  if (
    losesEvidence(current.content, incoming.content) ||
    losesEvidence(current.metadata, incoming.metadata)
  )
    return 'conflict'
  // Missing fields and shorter source snapshots cannot erase known evidence.
  if (
    Object.keys(current).some(
      (key) =>
        current[key] !== null &&
        current[key] !== undefined &&
        (incoming[key] === null || incoming[key] === undefined),
    )
  )
    return 'stale'
  if (
    (fingerprints?.incomingLength ?? afterFingerprint.length) <
      (fingerprints?.currentLength ?? beforeFingerprint.length) &&
    !(!terminal(current) && terminal(incoming))
  )
    return 'stale'
  return 'advance'
}
