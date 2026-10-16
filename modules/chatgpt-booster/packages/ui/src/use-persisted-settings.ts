import {
  type BoosterSettings,
  type BoosterSettingsPatch,
  mergeSettings,
  type SettingsAdapter,
  snapshotSettings,
} from '@chatgpt-booster/core'
import { onBeforeUnmount, ref } from 'vue'

/** One acknowledged write path for controls and async connection forms. */
export function usePersistedSettings(adapter: SettingsAdapter) {
  const settings = ref<BoosterSettings>()
  const loading = ref(false),
    loadFailed = ref(false),
    saving = ref(false),
    saved = ref(false),
    saveFailed = ref(false)
  let unsubscribe: (() => void) | undefined
  let disposed = false,
    revision = 0,
    pending = 0
  let persisted: BoosterSettings | undefined
  const failedPatches = new Map<number, BoosterSettingsPatch>()
  let writes = Promise.resolve()
  let savedTimer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    if (loading.value) return
    loading.value = true
    loadFailed.value = false
    try {
      const next = snapshotSettings(await adapter.get())
      if (disposed) return
      settings.value = persisted = next
      unsubscribe?.()
      unsubscribe = adapter.subscribe((next) => {
        if (pending === 0 && !disposed) settings.value = persisted = snapshotSettings(next)
      })
    } catch {
      if (!disposed) loadFailed.value = true
    } finally {
      if (!disposed) loading.value = false
    }
  }
  async function persistPatch(patch: BoosterSettingsPatch, retryId?: number): Promise<boolean> {
    if (!settings.value || disposed) return false
    const current = ++revision
    pending++
    settings.value = mergeSettings(settings.value, patch)
    saving.value = true
    saved.value = false
    if (savedTimer) clearTimeout(savedTimer)
    let acknowledged = false
    const write = writes.then(async () => {
      try {
        const next = snapshotSettings(await adapter.update(patch))
        if (disposed) return
        persisted = next
        acknowledged = true
        if (retryId !== undefined) failedPatches.delete(retryId)
        saveFailed.value = failedPatches.size > 0
        if (current === revision) {
          settings.value = next
          saved.value = failedPatches.size === 0
          savedTimer = setTimeout(() => {
            saved.value = false
          }, 1200)
        }
      } catch {
        if (!disposed) {
          failedPatches.set(retryId ?? current, patch)
          saveFailed.value = true
          if (current === revision && persisted) settings.value = snapshotSettings(persisted)
        }
      } finally {
        pending--
        if (!disposed && pending === 0) saving.value = false
      }
    })
    writes = write
    await write
    return acknowledged
  }
  async function retrySave() {
    let acknowledged = true
    for (const [id, patch] of [...failedPatches])
      if (!(await persistPatch(patch, id))) acknowledged = false
    return acknowledged
  }
  onBeforeUnmount(() => {
    disposed = true
    unsubscribe?.()
    if (savedTimer) clearTimeout(savedTimer)
  })
  return {
    settings,
    loading,
    loadFailed,
    saving,
    saved,
    saveFailed,
    load,
    applyPatch: (patch: BoosterSettingsPatch) => persistPatch(patch),
    retrySave,
  }
}
