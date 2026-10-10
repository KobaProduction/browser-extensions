import { archiveCompositeKey } from '@kobaproduction/browser-archive'
import { projectNativeMessage } from '@chatgpt-booster/core'
import type { ArchiveV4Store } from './archive-v4-store'
import { canonicalSourceJson, sourceFingerprint } from './archive-v4-write'

type Row = Record<string, unknown>
const key = archiveCompositeKey
const asObject = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
const read = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Canonical backup database read failed'))
  })
const finish = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Canonical backup transaction aborted'))
  })
const schema = 'booster-canonical-backup-v1'

async function* scanConversation(db: IDBDatabase, conversationKey: string) {
  let after: IDBValidKey | null = null
  while (true) {
    const batch = await new Promise<{ values: Row[]; end: IDBValidKey | null }>(
      (resolve, reject) => {
        const values: Row[] = []
        let end: IDBValidKey | null = null
        let jumped = false
        const cursor = db
          .transaction('canonicalMessages', 'readonly')
          .objectStore('canonicalMessages')
          .index('byConversation')
          .openCursor(IDBKeyRange.only(conversationKey))
        cursor.onerror = () => reject(cursor.error ?? new Error('Backup source cursor failed'))
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) {
            resolve({ values, end })
            return
          }
          if (after !== null && !jumped) {
            jumped = true
            item.continuePrimaryKey(conversationKey, after)
            return
          }
          if (after !== null && indexedDB.cmp(item.primaryKey, after) <= 0) {
            item.continue()
            return
          }
          values.push(item.value as Row)
          end = item.primaryKey
          if (values.length === 16) resolve({ values, end })
          else item.continue()
        }
      },
    )
    for (const row of batch.values) yield row
    if (batch.values.length < 16 || batch.end === null) return
    after = batch.end
  }
}

/** Canonical-only external backup. Source v3/v4, unbound owners, native server
 * completeness and binary assets remain separate preservation requirements. */
export async function exportCanonicalBackup(
  store: ArchiveV4Store,
  accountId: string,
  activeGeneration: string,
): Promise<Blob> {
  if (!accountId || !activeGeneration) throw new Error('Verified canonical account required')
  if (typeof CompressionStream !== 'function' || !navigator.locks?.request)
    throw new Error('Canonical backup requires browser compression and cross-tab locking')
  return navigator.locks.request(
    'chatgpt-booster:canonical-migration-v1',
    { mode: 'shared' },
    async () => {
      const db = await store.canonicalDatabase()
      const manifest = await read<Row | undefined>(
        db
          .transaction('migrationManifest', 'readonly')
          .objectStore('migrationManifest')
          .get(key(accountId)),
      )
      const currentGeneration =
        manifest?.status === 'ready' ? manifest.generation : manifest?.previousGeneration
      if (currentGeneration !== activeGeneration)
        throw new Error('Archive generation changed before backup')
      let conversations = 0,
        messages = 0,
        snapshots = 0
      let chain = 'start'
      const lines = async function* () {
        const header = {
          kind: 'header',
          schema,
          accountId,
          modelVersion: 1,
          storageVersion: 2,
          scope: 'active_canonical_only',
          sourceGeneration: activeGeneration,
        }
        const encode = async (row: Row) => {
          const json = JSON.stringify(row)
          chain = await sourceFingerprint(chain + '\n' + json)
          return new TextEncoder().encode(json + '\n')
        }
        yield await encode(header)
        const headers = await read<Row[]>(
          db
            .transaction('canonicalConversations', 'readonly')
            .objectStore('canonicalConversations')
            .index('byAccount')
            .getAll(accountId),
        )
        for (const item of headers) {
          if (item.generation !== activeGeneration) continue
          const id = item.conversationId
          if (typeof id !== 'string' || !id || item.accountId !== accountId)
            throw new Error('Backup contains invalid conversation identity')
          conversations++
          yield await encode({
            kind: 'conversation',
            data: {
              conversationId: id,
              projectId: item.projectId,
              title: item.title,
              currentNodeId: item.currentNodeId,
              lastSeenAt: item.lastSeenAt,
              source: item.source,
              verifiedPagination: false,
            },
          })
          for await (const message of scanConversation(
            db,
            key(activeGeneration, key(accountId, id)),
          )) {
            if (
              message.accountId !== accountId ||
              message.generation !== activeGeneration ||
              message.conversationId !== id ||
              typeof message.messageId !== 'string'
            )
              throw new Error('Backup source message identity mismatch')
            const snapshotRows = await read<Row[]>(
              db
                .transaction('sourceSnapshots', 'readonly')
                .objectStore('sourceSnapshots')
                .index('byMessage')
                .getAll(message.key as IDBValidKey),
            )
            const copies: Row[] = []
            for (const source of snapshotRows) {
              if (source.generation !== activeGeneration || source.messageKey !== message.key)
                continue
              const raw = asObject(source.raw)
              if (
                !raw ||
                raw.id !== message.messageId ||
                (await sourceFingerprint(canonicalSourceJson(raw))) !== source.fingerprint
              )
                throw new Error('Cannot back up a damaged native source snapshot')
              copies.push({ source: source.source, fingerprint: source.fingerprint, raw })
            }
            if (
              !copies.some(
                (copy) =>
                  copy.fingerprint === message.sourceFingerprint &&
                  copy.source === (message.source ?? 'native'),
              )
            )
              throw new Error('Cannot back up a message with missing preferred native snapshot')
            snapshots += copies.length
            messages++
            yield await encode({
              kind: 'message',
              conversationId: id,
              messageId: message.messageId,
              source: message.source,
              sourceFingerprint: message.sourceFingerprint,
              projection: message.projection,
              snapshots: copies,
            })
          }
        }
        const last = await read<Row | undefined>(
          db
            .transaction('migrationManifest', 'readonly')
            .objectStore('migrationManifest')
            .get(key(accountId)),
        )
        const now = last?.status === 'ready' ? last.generation : last?.previousGeneration
        if (now !== activeGeneration) throw new Error('Archive generation changed during backup')
        yield new TextEncoder().encode(
          JSON.stringify({ kind: 'footer', conversations, messages, snapshots, checksum: chain }) +
            '\n',
        )
      }
      const iterator = lines()
      const stream = new ReadableStream<BufferSource>({
        async pull(controller) {
          try {
            const next = await iterator.next()
            if (next.done) controller.close()
            else controller.enqueue(next.value)
          } catch (cause) {
            controller.error(cause)
          }
        },
        async cancel() {
          await iterator.return(undefined)
        },
      })
      const reader = stream.pipeThrough(new CompressionStream('gzip')).getReader()
      const parts: BlobPart[] = []
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          parts.push(next.value)
        }
      } finally {
        reader.releaseLock()
      }
      return new Blob(parts, { type: 'application/gzip' })
    },
  )
}

/** Explicit user-selected restore. Every row is checked before persisting in a
 * new invisible generation. Only a validated footer activates it atomically;
 * interrupted/invalid imports retain the old verified generation. */
export async function restoreCanonicalBackup(
  store: ArchiveV4Store,
  accountId: string,
  file: Blob,
  stillAuthorized: () => boolean = () => true,
): Promise<{ conversations: number; messages: number; snapshots: number }> {
  if (!accountId || !stillAuthorized() || !navigator.locks?.request || typeof DecompressionStream !== 'function')
    throw new Error('Verified account, browser lock and gzip support required')
  return navigator.locks.request(
    'chatgpt-booster:canonical-migration-v1',
    { mode: 'exclusive' },
    async () => {
      const db = await store.canonicalDatabase()
      let previous = await read<Row | undefined>(
        db
          .transaction('migrationManifest', 'readonly')
          .objectStore('migrationManifest')
          .get(key(accountId)),
      )
      // An abrupt tab/process termination skips the catch block below. The
      // exclusive lock proves no other importer remains active; recognize our
      // own uncommitted backup staging by its marker and restore the prior
      // active generation (or a recoverable empty state) without deleting rows.
      if (previous?.status === 'transforming' &&
          typeof previous.backupRestoreStartedAt === 'number') {
        const prior = previous.previousGeneration
        let restored: Row
        if (typeof prior === 'string' && prior) {
          const readable = await read<number>(db.transaction('canonicalConversations', 'readonly')
            .objectStore('canonicalConversations').index('byGeneration').count(prior))
          if (!readable) throw new Error('Backup recovery previous generation is missing')
          restored = { ...previous, generation: prior, previousGeneration: null,
            status: 'ready', interruptedBackupGeneration: previous.generation,
            backupRestoreStartedAt: null, interruptedBackupRecoveredAt: Date.now() }
        } else {
          restored = { ...previous, status: 'failed_recoverable',
            backupRestoreStartedAt: null, previousGeneration: null,
            interruptedBackupGeneration: previous.generation,
            interruptedBackupRecoveredAt: Date.now() }
        }
        const tx = db.transaction('migrationManifest', 'readwrite')
        const done = finish(tx)
        tx.objectStore('migrationManifest').put(restored)
        await done
        previous = restored
      }
      // A replacement extension/profile may have no canonical generation yet.
      // Importing an owner-verified, checksum-verified file must be possible
      // without initializing or deleting legacy source databases.
      if (previous && previous.status !== 'ready' && previous.status !== 'failed_recoverable')
        throw new Error('Another archive migration is active or unsupported')
      if (previous?.status === 'ready' && typeof previous.generation !== 'string')
        throw new Error('Existing canonical generation is malformed')
      const previousGeneration = previous?.status === 'ready' ? previous.generation as string : null
      const generation = crypto.randomUUID()
      const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let chain = 'start'
      let started = false,
        footer = false,
        fenced = false
      let conversations = 0,
        messages = 0,
        snapshots = 0
      const knownConversations = new Set<string>()
      const apply = async (line: string) => {
        if (!stillAuthorized()) throw new Error('Archive account changed during import')
        const row = asObject(JSON.parse(line))
        if (!row || typeof row.kind !== 'string') throw new Error('Invalid canonical backup record')
        if (footer) throw new Error('Unexpected records after backup footer')
        if (row.kind === 'footer') {
          if (
            !started ||
            row.conversations !== conversations ||
            row.messages !== messages ||
            row.snapshots !== snapshots ||
            row.checksum !== chain
          )
            throw new Error('Canonical backup footer or digest mismatch')
          footer = true
          return
        }
        chain = await sourceFingerprint(chain + '\n' + line)
        if (row.kind === 'header') {
          if (
            started ||
            row.schema !== schema ||
            row.accountId !== accountId ||
            row.modelVersion !== 1 ||
            row.storageVersion !== 2 ||
            row.scope !== 'active_canonical_only'
          )
            throw new Error('Backup schema or verified account mismatch')
          started = true
          const tx = db.transaction('migrationManifest', 'readwrite')
          const done = finish(tx)
          tx.objectStore('migrationManifest').put({
            key: key(accountId),
            accountId,
            status: 'transforming',
            generation,
            previousGeneration,
            storageSchemaVersion: 2,
            canonicalModelVersion: 1,
            backupRestoreStartedAt: Date.now(),
          })
          await done
          fenced = true
          return
        }
        if (!started) throw new Error('Backup header is missing')
        if (row.kind === 'conversation') {
          const data = asObject(row.data)
          if (
            !data ||
            typeof data.conversationId !== 'string' ||
            !data.conversationId ||
            knownConversations.has(data.conversationId)
          )
            throw new Error('Invalid or duplicate backup conversation')
          const id = data.conversationId
          knownConversations.add(id)
          const tx = db.transaction('canonicalConversations', 'readwrite')
          const done = finish(tx)
          tx.objectStore('canonicalConversations').put({
            key: key(generation, key(accountId, id)),
            accountId,
            conversationId: id,
            projectId: typeof data.projectId === 'string' ? data.projectId : null,
            title: typeof data.title === 'string' ? data.title : null,
            currentNodeId: typeof data.currentNodeId === 'string' ? data.currentNodeId : null,
            lastSeenAt: typeof data.lastSeenAt === 'number' ? data.lastSeenAt : 0,
            source: data.source,
            verifiedPagination: false,
            generation,
          })
          await done
          conversations++
          return
        }
        if (
          row.kind !== 'message' ||
          typeof row.conversationId !== 'string' ||
          !knownConversations.has(row.conversationId) ||
          typeof row.messageId !== 'string' ||
          !row.messageId ||
          !Array.isArray(row.snapshots) ||
          row.snapshots.length === 0
        )
          throw new Error('Invalid or out-of-order canonical message in backup')
        const cid = row.conversationId
        const rawSnapshots: { source: string; fingerprint: string; raw: Row }[] = []
        for (const source of row.snapshots) {
          const entry = asObject(source)
          const raw = asObject(entry?.raw)
          if (
            !entry ||
            !raw ||
            raw.id !== row.messageId ||
            !['legacy_v3', 'legacy_v4', 'native'].includes(String(entry.source)) ||
            typeof entry.fingerprint !== 'string' ||
            (await sourceFingerprint(canonicalSourceJson(raw))) !== entry.fingerprint
          )
            throw new Error('Backup native snapshot checksum mismatch')
          rawSnapshots.push({ source: entry.source as string, fingerprint: entry.fingerprint, raw })
        }
        const selected = rawSnapshots.find(
          (source) =>
            source.source === (row.source ?? 'native') &&
            source.fingerprint === row.sourceFingerprint,
        )
        if (!selected) throw new Error('Backup preferred native snapshot is missing')
        const projection = asObject(row.projection)
        const expected = projectNativeMessage(selected.raw, { accountId, conversationId: cid })
        if (!projection || canonicalSourceJson(projection) !== canonicalSourceJson(expected))
          throw new Error('Backup canonical projection does not match native source')
        const conversationKey = key(generation, key(accountId, cid))
        const messageKey = key(conversationKey, row.messageId)
        const tx = db.transaction(
          ['canonicalMessages', 'canonicalElements', 'sourceSnapshots'],
          'readwrite',
        )
        const done = finish(tx)
        tx.objectStore('canonicalMessages').put({
          key: messageKey,
          conversationKey,
          accountId,
          conversationId: cid,
          messageId: row.messageId,
          sourceCreateTime: expected.sourceCreateTime,
          sourceFingerprint: row.sourceFingerprint,
          source: row.source,
          generation,
          projection: expected,
        })
        for (const element of expected.elements)
          tx.objectStore('canonicalElements').put({
            ...element,
            elementId: key(generation, element.elementId),
            messageKey,
            generation,
          })
        for (const source of rawSnapshots)
          tx.objectStore('sourceSnapshots').put({
            key: key(messageKey, source.source, source.fingerprint),
            messageKey,
            generation,
            fingerprint: source.fingerprint,
            source: source.source,
            raw: source.raw,
          })
        await done
        messages++
        snapshots += rawSnapshots.length
      }
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          buffer += decoder.decode(part.value, { stream: true })
          if (buffer.length > 512 * 1024 * 1024)
            throw new Error('Backup contains an oversized single record')
          let at = buffer.indexOf('\n')
          while (at !== -1) {
            const line = buffer.slice(0, at)
            buffer = buffer.slice(at + 1)
            if (line) await apply(line)
            at = buffer.indexOf('\n')
          }
        }
        buffer += decoder.decode()
        if (buffer || !footer || !stillAuthorized()) throw new Error('Canonical backup is incomplete or the account changed')
        const tx = db.transaction(
          ['canonicalMessages', 'canonicalConversations', 'sourceSnapshots', 'migrationManifest'],
          'readwrite',
        )
        const done = finish(tx)
        const [actualMessages, actualConversations, actualSnapshots] = await Promise.all([
          read<number>(tx.objectStore('canonicalMessages').index('byGeneration').count(generation)),
          read<number>(
            tx.objectStore('canonicalConversations').index('byGeneration').count(generation),
          ),
          read<number>(tx.objectStore('sourceSnapshots').index('byGeneration').count(generation)),
        ])
        if (
          actualMessages !== messages ||
          actualConversations !== conversations ||
          actualSnapshots !== snapshots
        ) {
          tx.abort()
          throw new Error('Canonical backup staging counts differ from verified footer')
        }
        const manifest = await read<Row | undefined>(
          tx.objectStore('migrationManifest').get(key(accountId)),
        )
        if (manifest?.generation !== generation || manifest?.status !== 'transforming') {
          tx.abort()
          throw new Error('Archive restore lost its exclusive staging fence')
        }
        if (!stillAuthorized()) {
          tx.abort()
          throw new Error('Archive account changed before backup activation')
        }
        tx.objectStore('migrationManifest').put({
          key: key(accountId),
          accountId,
          status: 'ready',
          generation,
          storageSchemaVersion: 2,
          canonicalModelVersion: 1,
          messages,
          conversations,
          sourceSnapshots: snapshots,
          restoredFromBackupAt: Date.now(),
          previousGeneration,
        })
        await done
        return { conversations, messages, snapshots }
      } catch (error) {
        if (fenced) {
          const tx = db.transaction('migrationManifest', 'readwrite')
          const done = finish(tx)
          const manifest = await read<Row | undefined>(
            tx.objectStore('migrationManifest').get(key(accountId)),
          )
          if (manifest?.generation === generation && manifest.status === 'transforming')
            tx.objectStore('migrationManifest').put(previousGeneration && previous
              ? { ...previous, failedBackupRestoreAt: Date.now() }
              : { key: key(accountId), accountId, status: 'failed_recoverable',
                  generation, previousGeneration: null,
                  storageSchemaVersion: 2, canonicalModelVersion: 1,
                  failedBackupRestoreAt: Date.now() })
          await done
        }
        throw error
      } finally {
        void reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    },
  )
}

/** A verified rollback swaps only the active manifest. No source bytes are
 * deleted. It is refused after a newer reconciliation or native capture. */
export async function undoCanonicalBackupRestore(
  store: ArchiveV4Store,
  accountId: string,
  stillAuthorized: () => boolean = () => true,
): Promise<void> {
  if (!accountId || !stillAuthorized() || !navigator.locks?.request)
    throw new Error('Verified account and cross-tab archive lock required')
  await navigator.locks.request('chatgpt-booster:canonical-migration-v1', { mode: 'exclusive' }, async () => {
    const db = await store.canonicalDatabase()
    const tx = db.transaction(['migrationManifest', 'canonicalConversations', 'canonicalMessages', 'sourceSnapshots'], 'readwrite')
    const done = finish(tx)
    const manifests = tx.objectStore('migrationManifest')
    const active = await read<Row | undefined>(manifests.get(key(accountId)))
    if (active?.status !== 'ready' || typeof active.generation !== 'string' ||
        typeof active.previousGeneration !== 'string' ||
        typeof active.restoredFromBackupAt !== 'number' ||
        active.generation === active.previousGeneration ||
        (typeof active.lastReconciledAt === 'number' && active.lastReconciledAt > active.restoredFromBackupAt)) {
      tx.abort()
      throw new Error('No unchanged backup restoration is eligible for rollback')
    }
    const [priorConversations, priorMessages, priorSnapshots, currentMessages, currentSnapshots] = await Promise.all([
      read<number>(tx.objectStore('canonicalConversations').index('byGeneration').count(active.previousGeneration)),
      read<number>(tx.objectStore('canonicalMessages').index('byGeneration').count(active.previousGeneration)),
      read<number>(tx.objectStore('sourceSnapshots').index('byGeneration').count(active.previousGeneration)),
      read<number>(tx.objectStore('canonicalMessages').index('byGeneration').count(active.generation)),
      read<number>(tx.objectStore('sourceSnapshots').index('byGeneration').count(active.generation)),
    ])
    if (!priorConversations || !priorMessages || currentMessages !== active.messages ||
        currentSnapshots !== active.sourceSnapshots || !stillAuthorized()) {
      tx.abort()
      throw new Error('Archive changed or the previous generation is unavailable')
    }
    manifests.put({
      ...active, generation: active.previousGeneration, previousGeneration: null,
      restoredFromBackupAt: null, backupRestoreUndoneAt: Date.now(),
      undoneRestoreGeneration: active.generation,
      conversations: priorConversations, messages: priorMessages,
      sourceSnapshots: priorSnapshots,
    })
    await done
  })
}
