import type { ApplicationBackupSource, BackupRow, BackupRowReader } from '@kobaproduction/browser-core'
import type {
  PersistentSettingsPort,
  PortableBackupIndexedPort,
  PortableBackupReader,
  PortableBackupRow,
} from '@kobaproduction/browser-storage'

export function createSettingsBackupSource<T>(
  id: string,
  label: string,
  port: PersistentSettingsPort<T>,
  kind: 'settings' | 'session' = 'settings',
): ApplicationBackupSource {
  const validateSettingsRows = (rows: readonly BackupRow[]) => {
    if (rows.length !== 1 || rows[0]?.key !== 'value') throw Error('Invalid settings backup section')
    return port.validateSettings(rows[0].value)
  }
  const stagedValue = async (reader: BackupRowReader) => {
    if (reader.count !== 1) throw Error('Invalid settings backup section')
    const row = await reader.get('value')
    if (!row) throw Error('Missing settings backup value')
    return port.validateSettings(row.value)
  }
  return {
    id,
    label,
    kind,
    available: true,
    scope: port.scope,
    schema: { version: port.schemaVersion },
    async *readRows() {
      yield { key: 'value', value: port.validateSettings(await port.exportSettings()) }
    },
    validateRows(rows) {
      validateSettingsRows(rows)
    },
    restoreRows(rows) {
      return port.restoreSettingsAtomically(validateSettingsRows(rows))
    },
    async validateStagedRows(reader) {
      await stagedValue(reader)
    },
    async restoreStagedRows(reader) {
      await port.restoreSettingsAtomically(await stagedValue(reader))
    },
  }
}
export function createIndexedBackupSource(
  id: string,
  label: string,
  port: PortableBackupIndexedPort,
): ApplicationBackupSource {
  const rowOf = (row: BackupRow): PortableBackupRow => {
    const tuple: unknown = JSON.parse(row.key)
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 2 ||
      typeof tuple[0] !== 'string' ||
      typeof tuple[1] !== 'string' ||
      !tuple[1] ||
      tuple[1].length > 1024 ||
      !port.stores.includes(tuple[0]) ||
      JSON.stringify(tuple) !== row.key
    )
      throw Error('Invalid or noncanonical IndexedDB backup key')
    return { store: tuple[0], key: tuple[1], value: row.value }
  }
  const rowsOf = (rows: readonly BackupRow[]): PortableBackupRow[] => rows.map(rowOf)
  const validateStagedRows = port.validateStagedRows?.bind(port)
  const restoreStagedAtomically = port.restoreStagedAtomically?.bind(port)
  const stagedReaders = new WeakMap<BackupRowReader, PortableBackupReader>()
  const stagedReader = (reader: BackupRowReader): PortableBackupReader => {
    const cached = stagedReaders.get(reader)
    if (cached) return cached
    const converted: PortableBackupReader = Object.freeze({
      count: reader.count,
      async *readRows(store?: string) {
        if (store !== undefined && !port.stores.includes(store))
          throw Error('Unknown IndexedDB backup store')
        for await (const row of reader.rows()) {
          const value = rowOf(row)
          if (store === undefined || value.store === store) yield value
        }
      },
      async get(store: string, key: string) {
        if (!port.stores.includes(store) || !key || key.length > 1024)
          throw Error('Unknown IndexedDB backup key')
        const encoded = JSON.stringify([store, key])
        const row = await reader.get(encoded)
        if (!row) return undefined
        if (row.key !== encoded) throw Error('IndexedDB staged lookup mismatch')
        return rowOf(row)
      },
    })
    // Providers pin validation to this immutable stage identity. Activation
    // must see the same adapter so it can verify that preflight's source stamp.
    stagedReaders.set(reader, converted)
    return converted
  }
  return {
    id,
    label,
    kind: 'indexeddb',
    available: true,
    scope: port.scope,
    schema: { version: port.schemaVersion, stores: port.schema },
    async *readRows() {
      for await (const row of port.readRows(512))
        yield { key: JSON.stringify([row.store, row.key]), value: row.value }
    },
    async validateRows(rows) {
      const values = rowsOf(rows)
      if (!port.validateRows) throw Error('Provider does not support read-only backup validation')
      await port.validateRows(values)
    },
    restoreRows(rows) {
      return port.restoreAtomically(rowsOf(rows))
    },
    ...(validateStagedRows
      ? {
          async validateStagedRows(reader: BackupRowReader) {
            await validateStagedRows(stagedReader(reader))
          },
        }
      : {}),
    ...(restoreStagedAtomically
      ? {
          async restoreStagedRows(reader: BackupRowReader) {
            await restoreStagedAtomically(stagedReader(reader))
          },
        }
      : {}),
  }
}
