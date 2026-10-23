import { HISTORY_LOADER_STATE_EVENT, type HistoryLoaderState } from '@chatgpt-booster/core'
import { computed, onBeforeUnmount, onMounted, type Ref, ref, watch } from 'vue'
import type { ArchiveDataAdapter } from './mount'

export function useArchiveCollection(adapter: () => ArchiveDataAdapter, selectedId: Ref<string | null>) {
  const recoveryState = ref(adapter().getCollectionState?.())
  const recoveryError = ref(false)
  let alive = true
  let revision = 0
  const recovering = computed(
    () =>
      recoveryState.value?.conversationId === selectedId.value &&
      ['preparing', 'scrolling', 'waiting_for_load', 'backoff', 'saving'].includes(
        recoveryState.value?.phase ?? '',
      ),
  )
  watch(selectedId, () => {
    revision++
    recoveryError.value = false
  })
  const onState = (event: Event) => {
    recoveryState.value = (event as CustomEvent<HistoryLoaderState>).detail
  }
  onMounted(() => window.addEventListener(HISTORY_LOADER_STATE_EVENT, onState))
  onBeforeUnmount(() => {
    alive = false
    window.removeEventListener(HISTORY_LOADER_STATE_EVENT, onState)
  })
  async function recoverHistory() {
    const port = adapter(),
      id = selectedId.value,
      owner = port.currentAccountId?.()
    if (!id || id !== port.currentConversationId()) return
    const ticket = ++revision
    recoveryError.value = false
    try {
      await port.collectCurrent()
    } catch {
      if (alive && ticket === revision && id === selectedId.value && owner === port.currentAccountId?.())
        recoveryError.value = true
    }
  }
  function stopRecovery() {
    if (selectedId.value && recovering.value)
      adapter().stopCollection?.({
        conversationId: selectedId.value,
        sessionId: recoveryState.value?.sessionId,
        reason: 'user',
      })
  }
  return { recoveryState, recoveryError, recovering, recoverHistory, stopRecovery }
}
