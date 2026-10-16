import Dexie, { type Table } from 'dexie'
import { assertServiceScope, type ServiceScope } from './service-contract'

/** Credentials never enter this separately scoped delivery store or backups. */
export interface RemoteOutboxEvent {
  readonly id: string
  readonly kind: string
  readonly createdAt: number
  readonly sha256: string
  readonly parts: number
  readonly byteLength: number
  /** Persisted consent requirement; raw jobs stay paused after reconnect/mode withdrawal. */
  readonly sourceMode?: 'normalized' | 'raw'
}
export function remoteEventRequiresRaw(event: Pick<RemoteOutboxEvent, 'kind' | 'sourceMode'>): boolean {
  if (event.kind === 'archive.source-raw' || event.sourceMode === 'raw') return true
  if (event.sourceMode === 'normalized') return false
  // Older source/sync events can contain provider originals. Missing metadata
  // must not convert that backlog into a newly authorized normalized upload.
  return (
    event.sourceMode !== undefined ||
    event.kind.startsWith('sync-') ||
    event.kind.startsWith('archive.source-') ||
    event.kind === 'archive.page-observed'
  )
}
export interface RemoteOutboxRecord extends RemoteOutboxEvent {
  readonly attempts: number
  readonly nextAttemptAt: number
  readonly state: 'queued' | 'dead'
  readonly errorCode?: string
}
export interface RemoteCommandClaim {
  readonly id: string
  readonly fingerprint: string
  readonly expiresAt: number
  readonly state: 'running' | 'done'
  readonly ok?: boolean
  readonly errorCode?: string
}
export interface RemoteOutbox {
  readonly durable: boolean
  /** Canonical WS destination. A durable queue must never cross destinations. */
  readonly destination?: string
  enqueue(event: RemoteOutboxEvent, parts: readonly string[], limit: number): Promise<boolean>
  part(id: string, index: number): Promise<string | undefined>
  ready(now: number, limit: number, allowRaw?: boolean): Promise<readonly RemoteOutboxRecord[]>
  acknowledge(id: string): Promise<void>
  fail(id: string, nextAttemptAt: number, maxAttempts: number, errorCode: string): Promise<void>
  retryDeadLetters(): Promise<void>
  counts(): Promise<{ queued: number; deadLetter: number }>
  claimCommand(
    claim: RemoteCommandClaim,
    limit: number,
  ): Promise<'new' | 'duplicate' | 'conflict' | 'full'>
  command(id: string): Promise<RemoteCommandClaim | undefined>
  finishCommand(id: string, ok: boolean, errorCode?: string): Promise<void>
  close(): void
}
class RemoteOutboxDatabase extends Dexie {
  events!: Table<RemoteOutboxRecord, string>
  parts!: Table<{ eventId: string; index: number; data: string }, [string, number]>
  commands!: Table<RemoteCommandClaim, string>
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      events: '&id,state,[state+nextAttemptAt]',
      parts: '&[eventId+index],eventId',
      commands: '&id,expiresAt',
    })
  }
}
function destinationOf(value: string): string {
  if (!value) return ''
  const url = new URL(value)
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw Error('Invalid outbox destination')
  return url.href
}
export async function remoteOutboxDatabaseName(scope: ServiceScope, destination = ''): Promise<string> {
  assertServiceScope(scope)
  const token = JSON.stringify([
    scope.productId,
    scope.channel,
    scope.installationId ?? null,
    scope.ownerId ?? null,
    destinationOf(destination),
  ])
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  const key = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `koba-remote-outbox-v1-${scope.productId}-${scope.channel}-${key}`
}
/** Lazy: constructing a client does not open IndexedDB or start delivery. */
export function createRemoteOutbox(scope: ServiceScope, destination = ''): RemoteOutbox {
  assertServiceScope(scope)
  const identity = Object.freeze({ ...scope })
  const target = destinationOf(destination)
  let database: Promise<RemoteOutboxDatabase> | undefined
  let generation = 0
  const db = () => {
    if (!database) {
      const current = generation
      const pending = remoteOutboxDatabaseName(identity, target)
        .then((name) => {
          if (current !== generation) throw Error('Remote outbox was closed')
          return new RemoteOutboxDatabase(name)
        })
        .catch((error) => {
          if (current === generation) database = undefined
          throw error
        })
      database = pending
    }
    return database
  }
  return {
    durable: true,
    destination: target,
    async enqueue(event, parts, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid outbox limit')
      if (!parts.length || parts.length !== event.parts) throw Error('Invalid event fragments')
      if (event.sourceMode !== undefined && !['normalized', 'raw'].includes(event.sourceMode))
        throw Error('Invalid source delivery mode')
      const store = await db()
      return store.transaction('rw', store.events, store.parts, async () => {
        if (await store.events.get(event.id)) return true
        if ((await store.events.count()) >= limit) return false
        await store.events.add({
          ...event,
          attempts: 0,
          nextAttemptAt: event.createdAt,
          state: 'queued',
        })
        for (let start = 0; start < parts.length; start += 256)
          await store.parts.bulkAdd(
            parts
              .slice(start, start + 256)
              .map((data, index) => ({ eventId: event.id, index: start + index, data })),
          )
        return true
      })
    },
    async part(id, index) {
      return (await (await db()).parts.get([id, index]))?.data
    },
    async ready(now, limit, allowRaw = true) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw Error('Invalid delivery batch')
      return (await db()).events
        .where('[state+nextAttemptAt]')
        .between(['queued', 0], ['queued', now], true, true)
        .filter((row) => allowRaw || !remoteEventRequiresRaw(row))
        .limit(limit)
        .toArray()
    },
    async acknowledge(id) {
      const store = await db()
      await store.transaction('rw', store.events, store.parts, async () => {
        while (true) {
          const keys = await store.parts.where('eventId').equals(id).limit(256).primaryKeys()
          if (!keys.length) break
          await store.parts.bulkDelete(keys)
        }
        await store.events.delete(id)
      })
    },
    async fail(id, nextAttemptAt, maxAttempts, errorCode) {
      const store = await db()
      await store.transaction('rw', store.events, async () => {
        const row = await store.events.get(id)
        if (!row || row.state === 'dead') return
        const attempts = row.attempts + 1
        await store.events.put({
          ...row,
          attempts,
          nextAttemptAt,
          state: attempts >= maxAttempts ? 'dead' : 'queued',
          errorCode,
        })
      })
    },
    async retryDeadLetters() {
      const store = await db()
      await store.transaction('rw', store.events, async () => {
        // Updating state removes the current batch from this indexed query.
        while (true) {
          const rows = await store.events.where('state').equals('dead').limit(256).toArray()
          if (!rows.length) break
          await store.events.bulkPut(
            rows.map(({ errorCode: _errorCode, ...row }) => ({
              ...row,
              state: 'queued' as const,
              attempts: 0,
              nextAttemptAt: Date.now(),
            })),
          )
        }
      })
    },
    async counts() {
      const store = await db()
      return {
        queued: await store.events.where('state').equals('queued').count(),
        deadLetter: await store.events.where('state').equals('dead').count(),
      }
    },
    async claimCommand(claim, limit) {
      const store = await db()
      return store.transaction('rw', store.commands, async () => {
        // Expiration is pruned in bounded batches, rather than loading all keys.
        const expired = await store.commands
          .where('expiresAt')
          .belowOrEqual(Date.now())
          .limit(256)
          .primaryKeys()
        if (expired.length) await store.commands.bulkDelete(expired)
        const existing = await store.commands.get(claim.id)
        if (existing) return existing.fingerprint === claim.fingerprint ? 'duplicate' : 'conflict'
        if ((await store.commands.count()) >= limit) return 'full'
        await store.commands.add(claim)
        return 'new'
      })
    },
    async command(id) {
      return (await db()).commands.get(id)
    },
    async finishCommand(id, ok, errorCode) {
      const store = await db()
      await store.transaction('rw', store.commands, async () => {
        const previous = await store.commands.get(id)
        if (previous)
          await store.commands.put({
            ...previous,
            state: 'done',
            ok,
            ...(errorCode ? { errorCode } : {}),
          })
      })
    },
    close() {
      generation++
      const previous = database
      database = undefined
      void previous?.then((value) => value.close()).catch(() => undefined)
    },
  }
}
/** Remote-only intentionally loses pending events and dedup state on disposal. */
export function createVolatileRemoteOutbox(maxEncodedBytes = 128 * 1024 * 1024): RemoteOutbox {
  if (!Number.isSafeInteger(maxEncodedBytes) || maxEncodedBytes < 1)
    throw Error('Invalid volatile outbox budget')
  const events = new Map<string, RemoteOutboxRecord>()
  const fragments = new Map<string, readonly string[]>()
  const commands = new Map<string, RemoteCommandClaim>()
  let encodedBytes = 0
  return {
    durable: false,
    async enqueue(event, parts, limit) {
      if (event.sourceMode !== undefined && !['normalized', 'raw'].includes(event.sourceMode))
        throw Error('Invalid source delivery mode')
      if (events.has(event.id)) return true
      const size = parts.reduce((total, part) => total + part.length * 2, 0)
      if (events.size >= limit || size > maxEncodedBytes - encodedBytes) return false
      events.set(event.id, {
        ...structuredClone(event),
        attempts: 0,
        nextAttemptAt: event.createdAt,
        state: 'queued',
      })
      fragments.set(event.id, [...parts])
      encodedBytes += size
      return true
    },
    async part(id, index) {
      return fragments.get(id)?.[index]
    },
    async ready(now, limit, allowRaw = true) {
      return [...events.values()]
        .filter(
          (row) =>
            row.state === 'queued' &&
            row.nextAttemptAt <= now &&
            (allowRaw || !remoteEventRequiresRaw(row)),
        )
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, limit)
        .map((row) => structuredClone(row))
    },
    async acknowledge(id) {
      const parts = fragments.get(id)
      if (parts) encodedBytes -= parts.reduce((total, part) => total + part.length * 2, 0)
      events.delete(id)
      fragments.delete(id)
    },
    async fail(id, nextAttemptAt, maxAttempts, errorCode) {
      const row = events.get(id)
      if (!row || row.state === 'dead') return
      const attempts = row.attempts + 1
      events.set(id, {
        ...row,
        attempts,
        nextAttemptAt,
        state: attempts >= maxAttempts ? 'dead' : 'queued',
        errorCode,
      })
    },
    async retryDeadLetters() {
      for (const [id, row] of events)
        if (row.state === 'dead') {
          const { errorCode: _errorCode, ...event } = row
          events.set(id, { ...event, state: 'queued', attempts: 0, nextAttemptAt: Date.now() })
        }
    },
    async counts() {
      let queued = 0,
        deadLetter = 0
      for (const row of events.values()) {
        if (row.state === 'dead') deadLetter++
        else queued++
      }
      return { queued, deadLetter }
    },
    async claimCommand(claim, limit) {
      for (const [id, row] of commands) if (row.expiresAt <= Date.now()) commands.delete(id)
      const existing = commands.get(claim.id)
      if (existing) return existing.fingerprint === claim.fingerprint ? 'duplicate' : 'conflict'
      if (commands.size >= limit) return 'full'
      commands.set(claim.id, { ...claim })
      return 'new'
    },
    async command(id) {
      const row = commands.get(id)
      return row && { ...row }
    },
    async finishCommand(id, ok, errorCode) {
      const row = commands.get(id)
      if (row) commands.set(id, { ...row, state: 'done', ok, ...(errorCode ? { errorCode } : {}) })
    },
    close() {
      events.clear()
      fragments.clear()
      commands.clear()
      encodedBytes = 0
    },
  }
}
