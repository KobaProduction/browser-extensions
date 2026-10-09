import type { ArchiveMessageLocation, ArchiveWindowRequest } from '@chatgpt-booster/core'
import { ref } from 'vue'
import type { ArchiveThreadWindow, ArchiveWindowCursor } from './mount'

/** Owns the saved-copy revision/account pin and bounded window cursors.
 * This is a ChatGPT adapter until a canonical cross-provider reader contract is accepted.
 */
export function useArchiveWindowSession() {
  const readSource = ref<'auto' | 'live' | 'saved'>('auto')
  const readAccountId = ref<string | null>(null)
  const readRevision = ref<number | null>(null)
  const readInstanceId = ref<string | null>(null)
  const unsequencedTarget = ref(false)
  const requestedLocation = ref<ArchiveMessageLocation | null>(null)
  const olderStoredCursor = ref<ArchiveWindowCursor | null>(null)
  const newerStoredCursor = ref<ArchiveWindowCursor | null>(null)
  const hasOlderStored = ref(false)
  const hasNewerStored = ref(false)
  const usingIndexedWindows = ref(false)
  const knownStoredCount = ref(0)
  const hasUnsequencedRecords = ref(false)

  function windowRequest(controller: AbortController, pinRevision = true): ArchiveWindowRequest {
    return {
      source: readSource.value === 'saved' ? 'saved' : 'auto',
      signal: controller.signal,
      ...(readAccountId.value ? { expectedAccountId: readAccountId.value } : {}),
      ...(pinRevision && readSource.value === 'saved' && readRevision.value !== null
        ? { expectedRevision: readRevision.value, expectedInstanceId: readInstanceId.value }
        : {}),
    }
  }
  function acceptWindow(result: ArchiveThreadWindow): void {
    usingIndexedWindows.value = true
    olderStoredCursor.value = result.olderCursor
    newerStoredCursor.value = result.newerCursor
    hasOlderStored.value = result.hasOlderStored
    hasNewerStored.value = result.hasNewerStored
    knownStoredCount.value = result.totalKnownRecordCount
    hasUnsequencedRecords.value = result.hasUnsequencedRecords
    readSource.value = result.source ?? readSource.value
    readAccountId.value = result.accountId ?? readAccountId.value
    readRevision.value = result.sourceRevision ?? null
    readInstanceId.value = result.sourceInstanceId ?? null
    unsequencedTarget.value = result.unsequencedTarget === true
    // Never repin the message locator to another account's saved revision.
    if (
      requestedLocation.value &&
      result.source === 'saved' &&
      result.sourceRevision != null &&
      result.accountId === requestedLocation.value.accountId
    )
      requestedLocation.value = {
        ...requestedLocation.value,
        sourceRevision: result.sourceRevision,
        sourceInstanceId: result.sourceInstanceId ?? null,
      }
  }
  function clearWindow(): void {
    olderStoredCursor.value = null
    newerStoredCursor.value = null
    hasOlderStored.value = false
    hasNewerStored.value = false
    usingIndexedWindows.value = false
    knownStoredCount.value = 0
    hasUnsequencedRecords.value = false
    unsequencedTarget.value = false
  }
  function useSavedLocation(location: ArchiveMessageLocation, refreshRevision = false): void {
    requestedLocation.value = location
    readAccountId.value = location.accountId
    readSource.value = 'saved'
    readRevision.value = refreshRevision ? null : location.sourceRevision
    readInstanceId.value = refreshRevision ? null : (location.sourceInstanceId ?? null)
  }
  function resetSource(): void {
    requestedLocation.value = null
    readSource.value = 'auto'
    readAccountId.value = null
    readRevision.value = null
    readInstanceId.value = null
  }
  return {
    readSource,
    readAccountId,
    readRevision,
    readInstanceId,
    unsequencedTarget,
    requestedLocation,
    olderStoredCursor,
    newerStoredCursor,
    hasOlderStored,
    hasNewerStored,
    usingIndexedWindows,
    knownStoredCount,
    hasUnsequencedRecords,
    windowRequest,
    acceptWindow,
    clearWindow,
    useSavedLocation,
    resetSource,
  }
}
