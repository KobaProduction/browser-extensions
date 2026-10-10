/**
 * Pure, explicit migration routing. Side effects belong to the staged IndexedDB
 * migration executor; a missing step must NEVER fall through to an empty store.
 * External ChatGPT adapter versions are intentionally not part of this graph.
 */
export const CANONICAL_STORAGE_TARGET = 2
export const CANONICAL_MODEL_TARGET = 1

export type ArchiveMigrationAxis = 'storage' | 'canonical'
export type ArchiveMigrationPhase =
  | 'checking'
  | 'backup_verified'
  | 'staging'
  | 'transforming'
  | 'validating'
  | 'activating'
  | 'ready'
  | 'waiting_for_owner'
  | 'paused'
  | 'failed_recoverable'
  | 'unsupported_version'

export interface ArchiveManifest {
  readonly storageSchemaVersion: number
  readonly canonicalModelVersion: number
  readonly generation: string
  readonly phase: ArchiveMigrationPhase
}

export interface ArchiveMigrationStep {
  readonly id: string
  readonly axis: ArchiveMigrationAxis
  readonly from: number
  readonly to: number
}

export type MigrationRoute =
  | { status: 'ready'; steps: [] }
  | { status: 'migration_required'; steps: ArchiveMigrationStep[] }
  | {
      status: 'unsupported_version'
      reason: 'future_version' | 'missing_step' | 'invalid_manifest'
    }

function walkAxis(
  axis: ArchiveMigrationAxis,
  from: number,
  target: number,
  steps: readonly ArchiveMigrationStep[],
): ArchiveMigrationStep[] | null {
  const result: ArchiveMigrationStep[] = []
  let version = from
  while (version < target) {
    const next = steps.filter(
      (step) =>
        step.axis === axis && step.from === version && step.to > version && step.to <= target,
    )
    if (next.length !== 1 || !next[0] || !next[0].id) return null
    result.push(next[0])
    version = next[0].to
  }
  return result
}

/** No silent migration, downgrade, legacy alias or adapter-driven schema bump. */
export function planArchiveMigrations(
  manifest: ArchiveManifest,
  registered: readonly ArchiveMigrationStep[],
  target = {
    storageSchemaVersion: CANONICAL_STORAGE_TARGET,
    canonicalModelVersion: CANONICAL_MODEL_TARGET,
  },
): MigrationRoute {
  const numbers = [
    manifest.storageSchemaVersion,
    manifest.canonicalModelVersion,
    target.storageSchemaVersion,
    target.canonicalModelVersion,
  ]
  if (!manifest.generation || numbers.some((n) => !Number.isSafeInteger(n) || n < 0))
    return { status: 'unsupported_version', reason: 'invalid_manifest' }
  if (
    manifest.storageSchemaVersion > target.storageSchemaVersion ||
    manifest.canonicalModelVersion > target.canonicalModelVersion
  )
    return { status: 'unsupported_version', reason: 'future_version' }
  const storage = walkAxis(
    'storage',
    manifest.storageSchemaVersion,
    target.storageSchemaVersion,
    registered,
  )
  const canonical = walkAxis(
    'canonical',
    manifest.canonicalModelVersion,
    target.canonicalModelVersion,
    registered,
  )
  if (!storage || !canonical) return { status: 'unsupported_version', reason: 'missing_step' }
  const all = [...storage, ...canonical]
  return all.length ? { status: 'migration_required', steps: all } : { status: 'ready', steps: [] }
}

export type LegacyOwnerEvidence =
  | { status: 'verified'; accountId: string }
  | { status: 'waiting_for_owner'; accountId: null }
  | { status: 'mismatch'; accountId: null }

/**
 * The old v3 store has no account namespace. Merely having a verified session
 * does NOT prove that all legacy conversations belong to the current account.
 * Caller passes only previously verified immutable account identity.
 */
export function legacyV3OwnerEvidence(
  rawConversation: Readonly<Record<string, unknown>>,
  verifiedAccountId: string,
): LegacyOwnerEvidence {
  if (!verifiedAccountId) return { status: 'waiting_for_owner', accountId: null }
  const raw = rawConversation.raw
  const envelope =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null
  const owner = envelope?.owner
  const ownerRecord =
    owner !== null && typeof owner === 'object' && !Array.isArray(owner)
      ? (owner as Record<string, unknown>)
      : null
  if (!ownerRecord || typeof ownerRecord.user_id !== 'string' || !ownerRecord.user_id)
    return { status: 'waiting_for_owner', accountId: null }
  return ownerRecord.user_id === verifiedAccountId
    ? { status: 'verified', accountId: verifiedAccountId }
    : { status: 'mismatch', accountId: null }
}
