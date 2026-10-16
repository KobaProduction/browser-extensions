import {
  assertServiceScope,
  type PortableBackupRow,
  type ServiceScope,
} from '@kobaproduction/browser-storage'
import { REMOTE_JSON_MAX_DEPTH } from './remote-limits'
import type { RemoteSession } from './remote-session'

export type RemoteArchiveSyncPhase = 'starting' | 'rows' | 'finalizing' | 'queued'
export interface RemoteArchiveSyncProgress {
  readonly syncId: string
  readonly phase: RemoteArchiveSyncPhase
  /** Accepted by the client queue; never a count of server-delivered rows. */
  readonly queuedRows: number
}
export interface RemoteArchiveSyncResult {
  readonly syncId: string
  readonly queuedRows: number
  readonly rollingSHA256: string
  /** Whether every accepted logical event used the durable delivery queue. */
  readonly durable: boolean
}
export interface RemoteArchiveSyncOptions {
  readonly session: Pick<RemoteSession, 'publish' | 'status' | 'subscribe'>
  readonly scope: ServiceScope
  readonly schema: unknown
  /** Values already encoded by the provider's lossless portable row codec. */
  readonly readRows: () => AsyncIterable<PortableBackupRow>
  /** Owner/revision fence: called before start and after source exhaustion. */
  readonly validate: () => void | Promise<void>
  readonly valueEncoding?: string
  /** Raw companions require fresh local consent and server negotiation for every frame. */
  readonly sourceMode?: 'normalized' | 'raw'
  readonly signal?: AbortSignal
  /** Overall job bound, including source reads and online queue backpressure. */
  readonly timeoutMs?: number
  readonly onProgress?: (progress: RemoteArchiveSyncProgress) => void
}
export type RemoteArchiveSyncErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'offline'
  | 'queue-full'
  | 'publish-rejected'
  | 'invalid-source'
  | 'invalid-row'
  | 'source-changed'
  | 'source-failed'
export class RemoteArchiveSyncError extends Error {
  constructor(
    readonly code: RemoteArchiveSyncErrorCode,
    readonly syncId: string,
    readonly queuedRows: number,
  ) {
    super(`Remote archive synchronization stopped: ${code}`)
    this.name = 'RemoteArchiveSyncError'
  }
}

const textEncoder = new TextEncoder()
/** Canonical JSON with UTF-16 key ordering. No toJSON, undefined or raw blobs. */
function canonicalJSON(value: unknown, depth = 0): string {
  if (depth > REMOTE_JSON_MAX_DEPTH) throw Error('Portable row exceeds the nesting limit')
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
    return JSON.stringify(value)
  if (Array.isArray(value)) {
    const keys = Object.keys(value)
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)) ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      throw Error('Portable arrays must be dense')
    return `[${value.map((item) => canonicalJSON(item, depth + 1)).join(',')}]`
  }
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('Portable row requires a JSON source codec')
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string'))
    throw Error('Portable objects cannot contain symbol keys')
  return `{${Object.keys(fields)
    .sort()
    .map((key) => {
      const field = fields[key]
      if (!field?.enumerable || !('value' in field))
        throw Error('Portable object contains hidden fields or accessors')
      return `${JSON.stringify(key)}:${canonicalJSON(field.value, depth + 1)}`
    })
    .join(',')}}`
}
async function digest(value: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', value))
}
function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function joinHashes(previous: Uint8Array, row: Uint8Array): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(previous.length + row.length)
  joined.set(previous)
  joined.set(row, previous.length)
  return joined
}

/**
 * Explicit local-canonical -> WS resend. It never changes the source or claims
 * delivery. Server staging is keyed by outer scope + syncId: sync-start and
 * rows may arrive out of order, but publication requires sync-end, every
 * sequence [0,rowCount), and the matching SHA256 chain. Missing/failed jobs
 * remain unpublished and expire server-side; a retry uses a fresh syncId.
 */
export async function syncRemoteArchive(
  options: RemoteArchiveSyncOptions,
): Promise<RemoteArchiveSyncResult> {
  const syncId = crypto.randomUUID()
  let queuedRows = 0,
    durable = true,
    phase: RemoteArchiveSyncPhase = 'starting'
  const fail = (code: RemoteArchiveSyncErrorCode) => new RemoteArchiveSyncError(code, syncId, queuedRows)
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000)
    throw fail('invalid-source')
  const controller = new AbortController()
  let timedOut = false,
    iterator: AsyncIterator<PortableBackupRow> | undefined,
    exhausted = false
  const cancelled = () => controller.abort()
  options.signal?.addEventListener('abort', cancelled, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const assertActive = () => {
    if (controller.signal.aborted) throw fail(timedOut ? 'timeout' : 'cancelled')
  }
  const wait = <T>(operation: Promise<T>): Promise<T> => {
    assertActive()
    return new Promise<T>((resolve, reject) => {
      const aborted = () => {
        cleanup()
        reject(fail(timedOut ? 'timeout' : 'cancelled'))
      }
      const cleanup = () => controller.signal.removeEventListener('abort', aborted)
      controller.signal.addEventListener('abort', aborted, { once: true })
      operation.then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error) => {
          cleanup()
          reject(error)
        },
      )
    })
  }
  const report = (next: RemoteArchiveSyncPhase) => {
    phase = next
    try {
      options.onProgress?.({ syncId, phase, queuedRows })
    } catch {
      /* Presentation cannot change queue acceptance. */
    }
  }
  const online = () => options.session.status().state === 'online'
  const validate = async () => {
    try {
      await wait(Promise.resolve().then(() => options.validate()))
    } catch (error) {
      if (error instanceof RemoteArchiveSyncError) throw error
      throw fail('source-changed')
    }
  }
  const pause = () =>
    wait(
      new Promise<void>((resolve) => {
        const before = options.session.status().queued
        let unsubscribe: (() => void) | undefined,
          settled = false
        let poll: ReturnType<typeof setTimeout>
        const finish = () => {
          if (settled) return
          settled = true
          clearTimeout(poll)
          unsubscribe?.()
          controller.signal.removeEventListener('abort', finish)
          resolve()
        }
        const check = () => {
          const status = options.session.status()
          if (status.state !== 'online' || status.queued < before) finish()
          else poll = setTimeout(check, 250)
        }
        poll = setTimeout(check, 250)
        controller.signal.addEventListener('abort', finish, { once: true })
        unsubscribe = options.session.subscribe((status) => {
          if (status.state !== 'online' || status.queued < before) finish()
        })
        if (settled) unsubscribe()
      }),
    )
  const publish = async (kind: 'sync-start' | 'sync-row' | 'sync-end', payload: unknown) => {
    while (true) {
      assertActive()
      if (!online()) throw fail('offline')
      // Recheck after every queue wait, not just before entering finalization.
      if (kind === 'sync-end') {
        await validate()
        assertActive()
        if (!online()) throw fail('offline')
      }
      // An interrupted enqueue can still settle later. Its orphan staging rows
      // are harmless: without sync-end the server cannot publish this snapshot.
      // queuedRows counts only queue receipts observed before interruption.
      const receipt = await wait(
        options.session.publish(kind, payload, { sourceMode: options.sourceMode ?? 'raw' }),
      )
      if (receipt.accepted) {
        durable = durable && receipt.durable
        if (kind === 'sync-row') queuedRows++
        assertActive()
        return
      }
      assertActive()
      if (receipt.reason !== 'queue-full') throw fail('publish-rejected')
      if (!online()) throw fail('queue-full')
      await pause()
    }
  }
  try {
    assertActive()
    let scope: ServiceScope, schema: unknown, valueEncoding: string
    try {
      assertServiceScope(options.scope)
      scope = JSON.parse(canonicalJSON(options.scope)) as ServiceScope
      schema = JSON.parse(canonicalJSON(options.schema)) as unknown
      valueEncoding = options.valueEncoding ?? 'provider-portable-json-v1'
      if (!/^[a-z][a-z0-9.-]{0,127}$/.test(valueEncoding)) throw Error('Invalid row codec')
    } catch {
      throw fail('invalid-source')
    }
    if (!online()) throw fail('offline')
    await validate()
    let rolling = await wait(
      digest(
        textEncoder.encode(
          canonicalJSON(['koba-archive-sync', 1, syncId, scope, schema, valueEncoding]),
        ),
      ),
    )
    report('starting')
    await publish('sync-start', {
      syncId,
      scope,
      schema,
      valueEncoding,
      digestAlgorithm: 'sha256-chain-v1',
    })
    const rowIterator = options.readRows()[Symbol.asyncIterator]()
    iterator = rowIterator
    report('rows')
    while (true) {
      assertActive()
      if (!online()) throw fail('offline')
      const next = await wait(Promise.resolve().then(() => rowIterator.next()))
      if (next.done) {
        exhausted = true
        break
      }
      let encoded: string, row: PortableBackupRow
      try {
        const candidate = next.value
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          Object.keys(candidate).some((key) => !['store', 'key', 'value'].includes(key)) ||
          typeof candidate.store !== 'string' ||
          !candidate.store ||
          candidate.store.length > 256 ||
          typeof candidate.key !== 'string' ||
          !candidate.key ||
          candidate.key.length > 4096 ||
          !Number.isSafeInteger(queuedRows)
        )
          throw Error('Invalid portable row')
        encoded = canonicalJSON([queuedRows, candidate.store, candidate.key, candidate.value])
        const [, store, key, value] = JSON.parse(encoded) as [number, string, string, unknown]
        row = { store, key, value }
      } catch {
        throw fail('invalid-row')
      }
      const rowHash = await wait(digest(textEncoder.encode(encoded)))
      const nextRolling = await wait(digest(joinHashes(rolling, rowHash)))
      await publish('sync-row', {
        syncId,
        sequence: queuedRows,
        store: row.store,
        key: row.key,
        value: row.value,
        rowSHA256: hex(rowHash),
      })
      rolling = nextRolling
      report('rows')
    }
    report('finalizing')
    const rollingSHA256 = hex(rolling)
    await publish('sync-end', { syncId, rowCount: queuedRows, rollingSHA256 })
    report('queued')
    return { syncId, queuedRows, rollingSHA256, durable }
  } catch (error) {
    if (error instanceof RemoteArchiveSyncError) throw error
    assertActive()
    throw fail('source-failed')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancelled)
    if (iterator && !exhausted) {
      // Do not wait for a provider's noncooperative pending read on cancellation.
      try {
        void Promise.resolve(iterator.return?.()).catch(() => undefined)
      } catch {
        /* Source owns cleanup failures. */
      }
    }
  }
}
