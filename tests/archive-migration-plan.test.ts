import { describe, expect, test } from 'bun:test'
import {
  legacyV3OwnerEvidence,
  planArchiveMigrations,
} from '../packages/features/src/archive-migration-plan'

describe('canonical archive migration planning', () => {
  const manifest = {
    storageSchemaVersion: 1,
    canonicalModelVersion: 0,
    generation: 'existing-generation',
    phase: 'checking' as const,
  }
  const steps = [
    { id: 'storage-1-2', axis: 'storage' as const, from: 1, to: 2 },
    { id: 'canonical-0-1', axis: 'canonical' as const, from: 0, to: 1 },
  ]

  test('requires a complete explicit ordered path and rejects unknown upgrades', () => {
    expect(planArchiveMigrations(manifest, steps)).toEqual({
      status: 'migration_required',
      steps,
    })
    expect(planArchiveMigrations(manifest, steps.slice(0, 1))).toEqual({
      status: 'unsupported_version',
      reason: 'missing_step',
    })
    expect(planArchiveMigrations({ ...manifest, storageSchemaVersion: 999 }, steps)).toEqual({
      status: 'unsupported_version',
      reason: 'future_version',
    })
    expect(
      planArchiveMigrations(
        { ...manifest, canonicalModelVersion: 1, storageSchemaVersion: 2, phase: 'ready' },
        steps,
      ),
    ).toEqual({ status: 'ready', steps: [] })
  })

  test('legacy owner matches only explicit server owner evidence', () => {
    expect(
      legacyV3OwnerEvidence({ raw: { owner: { user_id: 'confirmed-a' } } }, 'confirmed-a'),
    ).toEqual({ status: 'verified', accountId: 'confirmed-a' })
    expect(legacyV3OwnerEvidence({ raw: {} }, 'confirmed-a').status).toBe('waiting_for_owner')
    expect(
      legacyV3OwnerEvidence({ raw: { owner: { user_id: 'another' } } }, 'confirmed-a').status,
    ).toBe('mismatch')
    expect(
      legacyV3OwnerEvidence({ raw: { owner: { user_email: 'not-an-id' } } }, 'confirmed-a').status,
    ).toBe('waiting_for_owner')
  })
})
