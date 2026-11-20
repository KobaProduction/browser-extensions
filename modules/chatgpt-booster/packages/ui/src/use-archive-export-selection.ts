import {
  type ArchiveExportMessageSummary,
  archiveExportSelectionIds,
  defaultArchiveExportSelection,
} from '@kobaproduction/browser-archive'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ArchiveDataAdapter } from './mount'

export function useArchiveExportSelection(
  props: {
    archiveAdapter: ArchiveDataAdapter
    conversationId: string
    selectedMessageIds?: readonly string[] | undefined
  },
  onReadFailed: () => void,
) {
  const exportSelection = ref({
    ...defaultArchiveExportSelection(),
    mode: props.selectedMessageIds?.length ? ('selected' as const) : ('all' as const),
  })
  const selectedIds = ref<readonly string[]>(
    props.selectedMessageIds ? [...props.selectedMessageIds] : [],
  )
  const selectionMessages = ref<readonly ArchiveExportMessageSummary[]>([])
  const selectionLoading = ref(false)
  let selectionController: AbortController | undefined
  let selectionGeneration = 0
  const selectionIds = computed(() => {
    try {
      return archiveExportSelectionIds(selectionMessages.value, exportSelection.value, selectedIds.value)
    } catch {
      return []
    }
  })
  async function loadSelectionMessages() {
    selectionController?.abort()
    if (exportSelection.value.mode === 'all') {
      selectionGeneration++
      selectionLoading.value = false
      return
    }
    const controller = new AbortController(),
      generation = ++selectionGeneration
    selectionController = controller
    selectionLoading.value = true
    const owner = props.archiveAdapter.currentAccountId?.()
    try {
      const messages = await props.archiveAdapter.getExportMessages?.(
        props.conversationId,
        controller.signal,
      )
      if (
        !controller.signal.aborted &&
        generation === selectionGeneration &&
        props.archiveAdapter.currentAccountId?.() === owner
      )
        selectionMessages.value = messages ?? []
    } catch {
      if (!controller.signal.aborted && generation === selectionGeneration) {
        selectionMessages.value = []
        onReadFailed()
      }
    } finally {
      if (generation === selectionGeneration) selectionLoading.value = false
    }
  }
  onMounted(loadSelectionMessages)
  onBeforeUnmount(() => selectionController?.abort())
  watch(
    () => exportSelection.value.mode,
    () => void loadSelectionMessages(),
  )
  watch(
    () => props.selectedMessageIds,
    (ids) => {
      selectedIds.value = ids ? [...ids] : []
    },
  )
  return {
    exportSelection,
    selectedIds,
    selectionMessages,
    selectionLoading,
    selectionIds,
    loadSelectionMessages,
  }
}
