<script setup lang="ts">
import {
  ARCHIVE_UPDATED_EVENT,
  type ArchiveItemView,
  type ArchiveMessageLocation,
  type ArchiveThreadView,
  type ArchiveWindowRequest,
} from '@chatgpt-booster/core'
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TooltipHint,
} from '@kobaproduction/browser-ui'
import {
  ArchiveConversationList,
  ArchiveIntegrityDetails,
  ArchiveIntegrityIndicator,
  ArchiveReaderNavigation,
  ArchiveReadingSurface,
  ArchiveRecordList,
  ConversationCollectionAction,
  createArchiveReadingScroll,
} from '@kobaproduction/browser-widgets'
import ArrowLeft from 'lucide-vue-next/dist/esm/icons/arrow-left.js'
import Database from 'lucide-vue-next/dist/esm/icons/database.js'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import MoreHorizontal from 'lucide-vue-next/dist/esm/icons/ellipsis.js'
import GripHorizontal from 'lucide-vue-next/dist/esm/icons/grip-horizontal.js'
import Info from 'lucide-vue-next/dist/esm/icons/info.js'
import ListTree from 'lucide-vue-next/dist/esm/icons/list-tree.js'
import LoaderCircle from 'lucide-vue-next/dist/esm/icons/loader-circle.js'
import Minus from 'lucide-vue-next/dist/esm/icons/minus.js'
import RefreshCw from 'lucide-vue-next/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-vue-next/dist/esm/icons/search.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import ArchiveFlowGraph from './ArchiveFlowGraph.vue'
import type ArchiveReaderActions from './ArchiveReaderActions.vue'
import ArchiveReaderDialog from './ArchiveReaderDialog.vue'
import ArchiveRecord from './ArchiveRecord.vue'
import {
  ARCHIVE_INITIAL_TURNS,
  ARCHIVE_TURN_BATCH,
  type ArchiveReadingOrder,
  archiveConversationForest,
  archiveTurnWindow,
} from './archive-navigation'
import { archiveReaderDetails } from './archive-reader-details'
import { mergeArchiveReaderWindows } from './archive-reader-window'
import { createArchiveRefreshQueue } from './archive-refresh-queue'
import CopyIdentity from './CopyIdentity.vue'
import { type SupportedLocale, type TranslationKey, translate } from './i18n'
import type {
  ArchiveConversationView,
  ArchiveCoverageView,
  ArchiveDataAdapter,
  ArchiveProjectView,
  ArchiveThreadWindow,
  ArchiveWindowCursor,
} from './mount'
import { useArchiveCollection } from './use-archive-collection'

const props = defineProps<{
  archiveAdapter: ArchiveDataAdapter
  initialConversationId?: string | null | undefined
  initialProjectId?: string | null
  locale: SupportedLocale
  windowed?: boolean
  openPosition?: 'first' | 'latest'
  navigationTarget?: ArchiveMessageLocation | null
  suspended?: boolean
  canReturnToExport?: boolean
}>()
const emit = defineEmits<{
  close: []
  minimize: []
  returnExport: []
  export: [conversationId: string, title: string | null, messageIds?: readonly string[]]
}>()
const t = (key: TranslationKey) => translate(props.locale, key)
const conversations = ref<ArchiveConversationView[]>([])
// Archive tools are intentionally opt-in. Opening the Reader never scans the
// legacy database or displays migration controls unprompted.
const accountPending = ref(!props.archiveAdapter.currentAccountId?.())
const projects = ref<ArchiveProjectView[]>([])
const selectedId = ref<string | null>(props.initialConversationId ?? null)
const siteDisplay = shallowRef(props.archiveAdapter.currentConversationDisplay?.())
const thread = ref<ArchiveThreadView>({ turns: [], messageCount: 0, recordCount: 0, detailCount: 0 })
const coverage = ref<ArchiveCoverageView>()
const coverageLoading = ref(false)
const coverageError = ref(false)
const listLoading = ref(false)
const threadLoading = ref(false)
const error = ref(false)
const staleSavedWindow = ref(false)
const navigationError = ref<TranslationKey | null>(null)
const requestedMessageId = ref<string | null>(null)
const readSource = ref<'auto' | 'live' | 'saved'>('auto')
const readAccountId = ref<string | null>(null)
const readRevision = ref<number | null>(null)
const readInstanceId = ref<string | null>(null)
const unsequencedTarget = ref(false)
const requestedLocation = ref<ArchiveMessageLocation | null>(null)
let windowController: AbortController | undefined
let sourceUnsubscribe: (() => void) | undefined
let interruptedLoad = false
const showingList = computed(() => selectedId.value === null)
const search = ref('')
const textSearch = ref('')
const visibleCount = ref(ARCHIVE_INITIAL_TURNS)
const readingOrder = ref<ArchiveReadingOrder>('chronological')
const searchOpen = ref(false)
const toolsOpen = ref(false)
const historyOpen = ref(false)
const readerActions = ref<InstanceType<typeof ArchiveReaderActions> | null>(null)
const timelineToggle = ref<{ $el: HTMLElement } | null>(null)
function closeHistory() {
  historyOpen.value = false
  void nextTick(() => {
    const button = timelineToggle.value?.$el
    if (button instanceof HTMLElement) button.focus({ preventScroll: true })
  })
}
const timelineNodes = ref<Awaited<ReturnType<NonNullable<ArchiveDataAdapter['getTimeline']>>>>([])
let timelineRevision = 0
const selectionEnabled = ref(false)
const selectedMessages = ref(new Set<string>())
const rangeStart = ref<string | null>(null)
const rangeEnd = ref<string | null>(null)
const rangeLoading = ref(false)
const selectedBranchTip = ref<string | null>(null)
const selectedBranchIds = ref<ReadonlySet<string> | null>(null)
const branchLoading = ref(false)
let branchRevision = 0
const itemKey = (item: ArchiveItemView) => item.record.messageKey
const itemMessageId = (item: ArchiveItemView) => item.record.messageId
const itemSelectionLabel = (item: ArchiveItemView) =>
  (props.locale === 'ru' ? 'Выбрать сообщение: ' : 'Select message: ') + item.text.slice(0, 80)
function selectMessage(id: string, checked: boolean) {
  const next = new Set(selectedMessages.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedMessages.value = next
}
watch(
  selectedId,
  () => {
    selectedMessages.value = new Set()
    rangeStart.value = null
    rangeEnd.value = null
    selectionEnabled.value = false
    selectedBranchTip.value = null
    selectedBranchIds.value = null
    inspectedVersionMessageId.value = null
    versionsOpen.value = false
    integrityOpen.value = false
    branchRevision++
    branchLoading.value = false
    toolsOpen.value = false
    timelineNodes.value = []
    timelineRevision++
  },
  { flush: 'sync' },
)
async function loadTimeline(id: string) {
  if (!props.archiveAdapter.getTimeline) return
  const ticket = ++timelineRevision,
    owner = props.archiveAdapter.currentAccountId?.()
  try {
    const nodes = await props.archiveAdapter.getTimeline(id)
    if (
      alive &&
      ticket === timelineRevision &&
      selectedId.value === id &&
      owner === props.archiveAdapter.currentAccountId?.()
    ) {
      timelineNodes.value = nodes
    }
  } catch {
    /* Keep previously verified metadata, never substitute fake links. */
  }
}
async function endRange() {
  const id = selectedId.value,
    first = rangeStart.value,
    last = focusedMessageId.value
  const owner = props.archiveAdapter.currentAccountId?.()
  if (!id || !first || !last || !props.archiveAdapter.getRangeMessageIds) return
  rangeLoading.value = true
  try {
    const ids = await props.archiveAdapter.getRangeMessageIds(id, first, last)
    if (selectedId.value !== id || owner !== props.archiveAdapter.currentAccountId?.()) return
    rangeEnd.value = last
    const branchIds = selectedBranchIds.value
    selectedMessages.value = new Set(
      branchIds ? ids.filter((messageId) => branchIds.has(messageId)) : ids,
    )
    selectionEnabled.value = true
  } catch (cause) {
    describeReadFailure(cause)
  } finally {
    rangeLoading.value = false
  }
}
async function chooseBranch(tipId: string) {
  const id = selectedId.value,
    owner = props.archiveAdapter.currentAccountId?.()
  if (!alive || !id || !props.archiveAdapter.getBranchPath) return
  const ticket = ++branchRevision
  inspectedVersionMessageId.value = null
  versionsOpen.value = false
  if (!tipId) {
    selectedBranchTip.value = null
    selectedBranchIds.value = null
    branchLoading.value = false
    return
  }
  branchLoading.value = true
  try {
    const path = await props.archiveAdapter.getBranchPath(id, tipId)
    if (
      !alive ||
      ticket !== branchRevision ||
      selectedId.value !== id ||
      props.archiveAdapter.currentAccountId?.() !== owner
    )
      return
    selectedBranchTip.value = tipId
    selectedBranchIds.value = new Set(path)
    await openMessage(tipId)
  } catch (cause) {
    if (ticket === branchRevision) describeReadFailure(cause)
  } finally {
    if (ticket === branchRevision) branchLoading.value = false
  }
}
function releaseBranchFilter() {
  branchRevision++
  inspectedVersionMessageId.value = null
  versionsOpen.value = false
  selectedBranchTip.value = null
  selectedBranchIds.value = null
  branchLoading.value = false
}
const versionsOpen = ref(false)
const inspectedVersionMessageId = ref<string | null>(null)
const integrityOpen = ref(false)
const { recoveryState, recoveryError, recovering, recoverHistory, stopRecovery } = useArchiveCollection(
  () => props.archiveAdapter,
  selectedId,
)
const navigationOpen = ref(false)
const showServiceRecords = ref(false)
let integrityTrigger: HTMLElement | undefined
function showIntegrityFromIndicator(event: MouseEvent) {
  integrityTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  integrityOpen.value = true
}
function revealReaderDetails(kind: 'integrity' | 'versions') {
  integrityTrigger = undefined
  integrityOpen.value = kind === 'integrity'
  const openingVersions = kind === 'versions' && !versionsOpen.value
  inspectedVersionMessageId.value = openingVersions ? focusedMessageId.value : null
  versionsOpen.value = openingVersions
}
function inspectMessage(id: string) {
  showServiceRecords.value = true
  integrityOpen.value = false
  navigationOpen.value = false
  void openMessage(id)
}
function restoreToolsFocus(event: Event) {
  event.preventDefault()
  void nextTick(() => readerActions.value?.focus())
}
function restoreIntegrityFocus(event: Event) {
  const trigger = integrityTrigger
  integrityTrigger = undefined
  if (!trigger?.isConnected) return restoreToolsFocus(event)
  event.preventDefault()
  void nextTick(() => trigger.focus({ preventScroll: true }))
}
const sourceVersions = ref<Awaited<ReturnType<NonNullable<ArchiveDataAdapter['getMessageVersions']>>>>(
  [],
)
const selectedVersion = ref(0)
const versionError = ref(false)
const versionsLoading = ref(false)
const variantsSourceRevision = ref(0)
const workspaceState = ref({ loading: false, loaded: 0, missingParents: 0, failed: false })
const liveRefresh = createArchiveRefreshQueue(async () => {
  const id = selectedId.value
  if (id) await refreshLiveSaved(id)
})
const coverageRefresh = createArchiveRefreshQueue(async () => {
  const id = selectedId.value
  if (!alive || !id || props.suspended || workspaceState.value.loading) return
  const revision = threadRevision
  const owner = props.archiveAdapter.currentAccountId?.()
  try {
    const next = await props.archiveAdapter.getCoverage(id)
    if (
      alive &&
      selectedId.value === id &&
      revision === threadRevision &&
      owner === props.archiveAdapter.currentAccountId?.()
    )
      coverage.value = next
  } catch {
    // A later source update retries the coverage read independently of the window.
  }
})
const timelineRefresh = createArchiveRefreshQueue(async () => {
  const id = selectedId.value
  if (id && historyOpen.value && !props.suspended && !workspaceState.value.loading)
    await loadTimeline(id)
})
watch([historyOpen, selectedId], ([open, id]) => {
  if (open && id) timelineRefresh.request()
})
function updateWorkspaceState(id: string | null) {
  workspaceState.value = (id ? props.archiveAdapter.workspaceStatus?.(id) : undefined) ?? {
    loading: false,
    loaded: 0,
    missingParents: 0,
    failed: false,
  }
}
let versionRevision = 0
const windowCenter = ref<number | null>(null)
const loadingOlder = ref(false)
let deferredLiveRefresh = false
watch([threadLoading, loadingOlder], ([loading, older]) => {
  if (!loading && !older && deferredLiveRefresh) {
    deferredLiveRefresh = false
    liveRefresh.request()
  }
})
const loadingDirection = ref<'older' | 'newer'>('older')
const loadedEdge = ref<'first' | 'middle' | 'latest'>('latest')
const olderStoredCursor = ref<ArchiveWindowCursor | null>(null)
const newerStoredCursor = ref<ArchiveWindowCursor | null>(null)
const hasOlderStored = ref(false)
const hasNewerStored = ref(false)
const usingIndexedWindows = ref(false)
const knownStoredCount = ref(0)
const knownRecordCount = computed(() =>
  Math.max(knownStoredCount.value, coverage.value?.knownMessageCount ?? 0, thread.value.recordCount),
)
const hasUnsequencedRecords = ref(false)
const readingScroll = ref<HTMLElement | null>(null)
const activeMessageKey = ref<string | null>(null)
const expanded = ref(new Set<string>())
let alive = true
let listRevision = 0
let threadRevision = 0
let scrollRevision = 0
let initialized = false
let resettingPosition = false
let windowShiftRevision = 0
let suppressSearchReset = false
let readFocusFrame: number | null = null
let explicitlyNavigatedTo: string | null = null
let contextUnsubscribe: (() => void) | undefined
let contextFallbackTimer: ReturnType<typeof setInterval> | undefined

const NONE = '__outside_projects__'
const selected = computed(() => {
  const id = selectedId.value
  if (!id) return undefined
  const saved = conversations.value.find((conversation) => conversation.conversationId === id)
  const siteTitle = siteDisplay.value?.id === id ? siteDisplay.value.title : null
  return {
    conversationId: id,
    projectId: saved?.projectId ?? null,
    branchSourceConversationId: saved?.branchSourceConversationId ?? null,
    branchSourceTitle: saved?.branchSourceTitle ?? null,
    title: siteTitle || saved?.title?.trim() || null,
  }
})
const projectLabel = (id: string | null) =>
  id
    ? projects.value.find((project) => project.projectId === id)?.title || t('identity.unknownProject')
    : t('reader.noProject')

const groups = computed(() => {
  const byProject = new Map<string, ArchiveConversationView[]>()
  for (const conversation of conversations.value) {
    const key = conversation.projectId ?? NONE
    const group = byProject.get(key) ?? []
    const site = siteDisplay.value
    group.push(
      site?.id === conversation.conversationId && site.title
        ? { ...conversation, title: site.title }
        : conversation,
    )
    byProject.set(key, group)
  }
  return [...byProject].flatMap(([id, items]) => {
    const label = projectLabel(id === NONE ? null : id)
    const rows = archiveConversationForest(items, search.value, label)
    return rows.length
      ? [
          {
            id,
            rows: rows.map((entry) => ({
              id: entry.conversation.conversationId,
              title: entry.conversation.title ?? '',
              depth: entry.depth,
              branched: entry.branched,
              sourceMissing: entry.sourceMissing,
            })),
            count: items.length,
            label,
          },
        ]
      : []
  })
})

const filteredTurns = computed(() => {
  const selected = selectedBranchIds.value
  const turns = selected
    ? thread.value.turns
        .map((turn) => ({
          ...turn,
          messages: turn.messages.filter((item) => selected.has(item.record.messageId)),
          details: turn.details.filter((item) => selected.has(item.record.messageId)),
        }))
        .filter((turn) => turn.messages.length || turn.details.length)
    : thread.value.turns
  const readable = turns
    .map((turn) => ({ ...turn, details: archiveReaderDetails(turn.details, showServiceRecords.value) }))
    .filter((turn) => turn.messages.length || turn.details.length)
  const term = textSearch.value.trim().toLocaleLowerCase()
  if (!term) return readable
  return readable.filter((turn) =>
    [...turn.messages, ...turn.details].some((item) =>
      (item.text + ' ' + (item.record.recipient ?? '')).toLocaleLowerCase().includes(term),
    ),
  )
})
const displayedTurns = computed(() => {
  if (windowCenter.value !== null) {
    const offset = Math.max(0, Math.min(filteredTurns.value.length - 1, windowCenter.value))
    const turns = filteredTurns.value.slice(
      Math.max(0, offset - 20),
      Math.min(filteredTurns.value.length, offset + 20),
    )
    return readingOrder.value === 'newest-first' ? [...turns].reverse() : turns
  }
  return archiveTurnWindow(filteredTurns.value, visibleCount.value, readingOrder.value)
})
const storedBranches = computed(() => coverage.value?.integrity?.branches ?? [])
function branchPreview(messageId: string) {
  return timelineNodes.value.find((item) => item.id === messageId)?.preview?.slice(0, 80) ?? messageId
}
const navigationNodes = computed(() =>
  thread.value.turns.flatMap((turn) =>
    turn.messages.filter((item) => item.kind === 'user' || item.kind === 'answer'),
  ),
)
const focusedMessageId = computed(
  () =>
    navigationNodes.value.find((item) => item.record.messageKey === activeMessageKey.value)?.record
      .messageId ??
    requestedMessageId.value ??
    navigationNodes.value.at(-1)?.record.messageId ??
    null,
)
// Opening details scrolls the transcript. Keep the explicitly inspected message
// separate from whichever message becomes visible at the new scroll position.
const versionMessageId = computed(() => inspectedVersionMessageId.value ?? focusedMessageId.value)
const versionItems = computed(
  () =>
    sourceVersions.value[selectedVersion.value]?.thread.turns.flatMap((turn) => [
      ...turn.messages,
      ...turn.details,
    ]) ?? [],
)
function evidenceLabel(value: string) {
  const labels: Record<string, [string, string]> = {
    verified: ['Подтверждено', 'Verified'],
    unknown: ['Нет подтверждения', 'Unverified'],
    missing: ['Не сохранено', 'Not saved'],
    'missing-parent': ['Разрыв: родитель не сохранён', 'Gap: parent not saved'],
    cycle: ['Цикл связей', 'Cyclic ancestry'],
    'unverified-root': ['Связь с предыдущим сообщением неизвестна', 'Previous-message link unknown'],
    'missing-head': ['Конечное сообщение не сохранено', 'Head message not saved'],
    initial: ['Исходное наблюдение', 'Initial observation'],
    advance: ['Дополнено', 'Enriched'],
    stale: ['Более старые данные', 'Older source data'],
    conflict: ['Противоречащий вариант', 'Conflicting variant'],
    identical: ['Повторное свидетельство', 'Repeated evidence'],
    disconnected: ['Отдельная цепочка', 'Disconnected chain'],
    'duplicate-id': ['Повтор идентификатора', 'Duplicate identity'],
  }
  return labels[value]?.[props.locale === 'ru' ? 0 : 1] ?? value
}
watch([selectedId, versionMessageId, variantsSourceRevision], async ([id, messageId], previous) => {
  const revision = ++versionRevision
  if (id !== previous?.[0] || messageId !== previous?.[1]) {
    sourceVersions.value = []
    selectedVersion.value = 0
  }
  versionError.value = false
  versionsLoading.value = false
  if (!id || !messageId || !props.archiveAdapter.getMessageVersions) return
  versionsLoading.value = true
  try {
    const versions = await props.archiveAdapter.getMessageVersions(id, messageId)
    if (alive && revision === versionRevision) {
      sourceVersions.value = versions
      selectedVersion.value = Math.min(selectedVersion.value, Math.max(0, versions.length - 1))
    }
  } catch {
    if (alive && revision === versionRevision) versionError.value = true
  } finally {
    if (alive && revision === versionRevision) versionsLoading.value = false
  }
})
const archiveStatusKey = computed<TranslationKey>(() =>
  coverage.value?.completeAtLastRead ? 'reader.savedToStart' : 'reader.savedPartial',
)
const emptyArchiveMessage = computed(() =>
  props.archiveAdapter.archiveGeneration === 4
    ? props.locale === 'ru'
      ? 'Этот архив пока не содержит записей. Данные предыдущего архива не удалены; для их переноса требуется проверенная миграция.'
      : 'This archive has no records yet. Older databases are not read by this version.'
    : t('reader.empty'),
)

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
function acceptWindow(result: ArchiveThreadWindow) {
  thread.value = result.thread
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
  if (
    requestedLocation.value &&
    result.source === 'saved' &&
    result.sourceRevision !== null &&
    result.sourceRevision !== undefined &&
    result.accountId === requestedLocation.value.accountId
  )
    requestedLocation.value = {
      ...requestedLocation.value,
      sourceRevision: result.sourceRevision,
      sourceInstanceId: result.sourceInstanceId ?? null,
    }
}
function currentWindow(): ArchiveThreadWindow {
  return {
    thread: thread.value,
    olderCursor: olderStoredCursor.value,
    newerCursor: newerStoredCursor.value,
    hasOlderStored: hasOlderStored.value,
    hasNewerStored: hasNewerStored.value,
    loadedRecordCount: thread.value.recordCount,
    totalKnownRecordCount: knownStoredCount.value,
    hasUnsequencedRecords: hasUnsequencedRecords.value,
    source: readSource.value === 'saved' ? 'saved' : 'live',
    sourceRevision: readRevision.value,
    sourceInstanceId: readInstanceId.value,
    accountId: readAccountId.value ?? undefined,
  }
}
const readerScroll = createArchiveReadingScroll({
  viewport: () => readingScroll.value,
  enabled: () =>
    alive &&
    !resettingPosition &&
    !props.suspended &&
    !staleSavedWindow.value &&
    !loadingOlder.value &&
    !threadLoading.value,
  order: () => (readingOrder.value === 'chronological' ? 'chronological' : 'reverse'),
  canLoad: (direction) => {
    const older = direction === 'older'
    if (windowCenter.value !== null)
      return older
        ? windowCenter.value > 20 || hasOlderStored.value
        : windowCenter.value + 20 < filteredTurns.value.length || hasNewerStored.value
    return older
      ? filteredTurns.value.length > visibleCount.value || hasOlderStored.value
      : hasNewerStored.value
  },
  load: async (direction) => {
    const older = direction === 'older'
    if (windowCenter.value !== null) {
      if (older && windowCenter.value > 20) await shiftWindow(-20)
      else if (!older && windowCenter.value + 20 < filteredTurns.value.length) await shiftWindow(20)
      else await loadAdjacent(direction)
    } else if (older && filteredTurns.value.length > visibleCount.value) await revealRetainedTurns()
    else await loadAdjacent(direction)
  },
})
function readingAnchor() {
  return readerScroll.capture('data-archive-message')
}
function restoreReadingAnchor(anchor: ReturnType<typeof readingAnchor>) {
  readerScroll.restore(anchor)
}
function cancelWindowWork() {
  readerScroll.reset()
  windowController?.abort()
  windowController = undefined
  threadRevision++
  scrollRevision++
  windowShiftRevision++
  loadingOlder.value = false
  threadLoading.value = false
  resettingPosition = false
}
function describeReadFailure(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'AbortError') return
  const key = cause instanceof Error ? cause.message : ''
  staleSavedWindow.value = key === 'archive.error.sourceChanged'
  navigationError.value =
    key === 'archive.error.messageMissing'
      ? 'reader.messageMissing'
      : key === 'archive.error.auth'
        ? 'archive.error.auth'
        : key === 'archive.error.incompatibleSource'
          ? 'archive.error.incompatibleSource'
          : null
  error.value = !staleSavedWindow.value && !navigationError.value
}
function bindSourceChanges(id: string) {
  sourceUnsubscribe?.()
  updateWorkspaceState(id)
  sourceUnsubscribe = props.archiveAdapter.subscribeExportChanges?.(id, () => {
    updateWorkspaceState(id)
    if (props.archiveAdapter.liveSavedUpdates && selectedId.value === id) {
      variantsSourceRevision.value++
      coverageRefresh.request()
      liveRefresh.request()
      timelineRefresh.request()
      return
    }
    if (readSource.value !== 'saved' || selectedId.value !== id) return
    // Keep the inspected copy visible, but never concatenate a changed revision.
    cancelWindowWork()
    staleSavedWindow.value = true
  })
}
async function refreshLiveSaved(id: string) {
  if (!alive || selectedId.value !== id || props.suspended) return
  if (threadLoading.value || loadingOlder.value) {
    deferredLiveRefresh = true
    return
  }
  const revision = threadRevision,
    owner = props.archiveAdapter.currentAccountId?.()
  const anchor = readingAnchor()
  const focus = anchor?.id ?? focusedMessageId.value,
    scroller = readingScroll.value
  const top = scroller?.scrollTop ?? 0
  const atEnd =
    !hasNewerStored.value && (scroller ? scroller.scrollHeight - top - scroller.clientHeight < 40 : true)
  const controller = new AbortController()
  try {
    const result =
      focus && !atEnd && props.archiveAdapter.getMessageWindow
        ? await props.archiveAdapter.getMessageWindow(id, focus, windowRequest(controller, false))
        : props.archiveAdapter.getThreadWindow
          ? await props.archiveAdapter.getThreadWindow(
              id,
              null,
              'older',
              windowRequest(controller, false),
            )
          : await props.archiveAdapter.getThread(id)
    if (
      !alive ||
      selectedId.value !== id ||
      revision !== threadRevision ||
      props.archiveAdapter.currentAccountId?.() !== owner
    )
      return
    if ('thread' in result) acceptWindow(result)
    else thread.value = result
    staleSavedWindow.value = false
    await nextTick()
    if (scroller) {
      if (atEnd) scroller.scrollTop = scroller.scrollHeight
      else restoreReadingAnchor(anchor)
    }
  } catch {
    /* Keep the last committed view; a later commit retries automatically. */
  }
}
async function focusMessage(messageId: string) {
  const revision = threadRevision
  const id = selectedId.value
  const owns = () => alive && revision === threadRevision && selectedId.value === id
  const item = thread.value.turns
    .flatMap((turn) => [...turn.messages, ...turn.details])
    .find((value) => value.record.messageId === messageId)
  if (!item) throw new Error('archive.error.messageMissing')
  suppressSearchReset = true
  textSearch.value = ''
  await nextTick()
  suppressSearchReset = false
  if (!owns()) return
  requestedMessageId.value = messageId
  explicitlyNavigatedTo = item.record.messageKey
  activeMessageKey.value = item.record.messageKey
  windowCenter.value = null
  visibleCount.value = thread.value.turns.length
  resettingPosition = true
  await nextTick()
  if (!owns()) return
  const element = [
    ...(readingScroll.value?.querySelectorAll<HTMLElement>('[data-archive-message]') ?? []),
  ].find((node) => node.dataset.archiveMessage === messageId)
  if (element && !props.suspended) {
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    element.focus({ preventScroll: true })
  }
  resettingPosition = false
  scheduleReadFocus()
}
async function openMessage(
  messageId: string,
  location?: ArchiveMessageLocation,
  refreshRevision = false,
) {
  if (!props.archiveAdapter.getMessageWindow) return
  const id = location?.conversationId ?? selectedId.value
  if (!id || !messageId.trim()) return
  selectedId.value = id
  requestedMessageId.value = messageId.trim()
  if (location) {
    requestedLocation.value = location
    readAccountId.value = location.accountId
    readSource.value = 'saved'
    readRevision.value = refreshRevision ? null : location.sourceRevision
    readInstanceId.value = refreshRevision ? null : (location.sourceInstanceId ?? null)
  } else {
    if (requestedLocation.value)
      requestedLocation.value = { ...requestedLocation.value, messageId: messageId.trim() }
    if (refreshRevision) {
      readRevision.value = null
      readInstanceId.value = null
    }
  }
  await loadThread(id, loadedEdge.value, messageId.trim())
}
function cancelNavigation() {
  cancelWindowWork()
  interruptedLoad = false
  navigationError.value = 'reader.navigationCancelled'
}
function retryLocation() {
  if (selectedId.value) props.archiveAdapter.retryWorkspace?.(selectedId.value)
  if (requestedMessageId.value)
    void openMessage(requestedMessageId.value, requestedLocation.value ?? undefined, true)
  else {
    readRevision.value = null
    readInstanceId.value = null
    void refresh()
  }
}
watch(
  () => props.navigationTarget,
  (target) => {
    if (!target || !initialized) return
    void openMessage(target.messageId, target)
  },
)
watch(
  () => props.suspended,
  (hidden) => {
    if (hidden) {
      interruptedLoad = threadLoading.value
      cancelWindowWork()
    } else if (interruptedLoad) {
      interruptedLoad = false
      if (requestedMessageId.value)
        void openMessage(requestedMessageId.value, requestedLocation.value ?? undefined)
      else void loadThread(selectedId.value)
    } else if (selectedId.value && props.archiveAdapter.liveSavedUpdates) {
      coverageRefresh.request()
      liveRefresh.request()
      timelineRefresh.request()
    }
  },
)

function toggleGroup(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}
function date(value?: number | null) {
  return value ? new Date(value).toLocaleString(props.locale) : ''
}

/** Reset each new view to its latest exchange, without moving the pinned controls. */
async function resetReadingPosition(edge: 'first' | 'middle' | 'latest' = loadedEdge.value) {
  readerScroll.reset()
  const ticket = ++scrollRevision
  resettingPosition = true
  visibleCount.value = edge !== 'latest' ? thread.value.turns.length : ARCHIVE_INITIAL_TURNS
  windowCenter.value = null
  loadingOlder.value = false
  await nextTick()
  if (!alive || scrollRevision !== ticket) return
  const viewport = readingScroll.value
  if (!viewport) {
    resettingPosition = false
    return
  }

  // A bounded window must remain bounded regardless of viewport geometry.
  // Loading more turns is driven only by navigation or user scroll.
  if (edge === 'middle')
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
  else if (edge === 'first') {
    viewport.scrollTop = readingOrder.value === 'chronological' ? 0 : viewport.scrollHeight
  } else {
    viewport.scrollTop = readingOrder.value === 'chronological' ? viewport.scrollHeight : 0
  }
  resettingPosition = false
  scheduleReadFocus()
}

async function loadAdjacent(direction: 'older' | 'newer') {
  const viewport = readingScroll.value
  const moreStored = direction === 'older' ? hasOlderStored.value : hasNewerStored.value
  if (
    !viewport ||
    loadingOlder.value ||
    threadLoading.value ||
    !moreStored ||
    staleSavedWindow.value ||
    props.suspended
  )
    return
  windowController?.abort()
  const controller = new AbortController()
  windowController = controller
  const ticket = scrollRevision
  const conversation = selectedId.value
  const beforeHeight = viewport.scrollHeight
  const beforeTop = viewport.scrollTop
  const anchor = readerScroll.capture()
  loadingDirection.value = direction
  loadingOlder.value = true
  try {
    await paintLoadingStatus()
    if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
    if (usingIndexedWindows.value && conversation && props.archiveAdapter.getThreadWindow) {
      const cursor = direction === 'older' ? olderStoredCursor.value : newerStoredCursor.value
      if (!cursor) return
      const result = await props.archiveAdapter.getThreadWindow(
        conversation,
        cursor,
        direction,
        windowRequest(controller),
      )
      if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
      if (controller.signal.aborted) return
      acceptWindow(mergeArchiveReaderWindows(currentWindow(), result, direction))
      // A focused sub-window must not trap navigation inside already retained turns.
      windowCenter.value = null
      visibleCount.value = thread.value.turns.length
    }
    await nextTick()
    if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
    if (!readerScroll.restore(anchor)) {
      if (hasNewerStored.value) {
        // When newest records are discarded, whole-scroll-height changes also
        // include the trimmed bottom. They cannot be used to anchor the top.
        viewport.scrollTop = beforeTop
      } else if (readingOrder.value === 'chronological')
        viewport.scrollTop = beforeTop + viewport.scrollHeight - beforeHeight
      else viewport.scrollTop = beforeTop
    }
  } catch (cause) {
    if (alive && ticket === scrollRevision) {
      describeReadFailure(cause)
    }
  } finally {
    if (windowController === controller) windowController = undefined
    if (alive && ticket === scrollRevision) loadingOlder.value = false
  }
}

function trackReadingPosition() {
  const viewport = readingScroll.value
  if (!viewport || resettingPosition) return
  const bounds = viewport.getBoundingClientRect()
  const anchorY = bounds.top + Math.min(140, bounds.height / 3)
  // Keep explicit graph/fork selection while that exact saved message remains
  // visible. Programmatic scrollIntoView fires scroll events too, and must not
  // immediately replace the selected node with the nearest neighboring turn.
  if (explicitlyNavigatedTo) {
    const selectedElement = [...viewport.querySelectorAll<HTMLElement>('[data-archive-node]')].find(
      (element) => element.dataset.archiveNode === explicitlyNavigatedTo,
    )
    const selectedBounds = selectedElement?.getBoundingClientRect()
    if (selectedBounds && selectedBounds.bottom > bounds.top && selectedBounds.top < bounds.bottom) {
      activeMessageKey.value = explicitlyNavigatedTo
      return
    }
    explicitlyNavigatedTo = null
  }

  let closest: HTMLElement | null = null
  let distance = Infinity
  for (const element of viewport.querySelectorAll<HTMLElement>('[data-archive-node]')) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue
    const offset = Math.abs(Math.max(bounds.top, rect.top) - anchorY)
    if (offset < distance) {
      closest = element
      distance = offset
    }
  }
  if (closest?.dataset.archiveNode) activeMessageKey.value = closest.dataset.archiveNode
}
function scheduleReadFocus() {
  if (readFocusFrame !== null) return
  readFocusFrame = requestAnimationFrame(() => {
    readFocusFrame = null
    trackReadingPosition()
  })
}

function onReadingScroll() {
  const viewport = readingScroll.value
  if (!viewport || resettingPosition || props.suspended || staleSavedWindow.value) return
  scheduleReadFocus()
  void readerScroll.onScroll().catch(describeReadFailure)
}
async function revealRetainedTurns() {
  const anchor = readingAnchor(),
    revision = threadRevision
  loadingOlder.value = true
  visibleCount.value = Math.min(filteredTurns.value.length, visibleCount.value + ARCHIVE_TURN_BATCH)
  await nextTick()
  if (alive && revision === threadRevision) {
    restoreReadingAnchor(anchor)
    loadingOlder.value = false
  }
}

async function paintLoadingStatus() {
  // Flush the real pending state; do not delay reads behind suspended animation frames.
  await nextTick()
}
async function shiftWindow(amount: number) {
  const viewport = readingScroll.value
  if (!viewport || loadingOlder.value || windowCenter.value === null) return
  const ticket = ++windowShiftRevision
  const conversation = selectedId.value
  const beforeTop = viewport.scrollTop
  const beforeHeight = viewport.scrollHeight
  loadingOlder.value = true
  await paintLoadingStatus()
  if (
    !alive ||
    ticket !== windowShiftRevision ||
    selectedId.value !== conversation ||
    windowCenter.value === null
  )
    return
  windowCenter.value = Math.max(0, Math.min(filteredTurns.value.length - 1, windowCenter.value + amount))
  await nextTick()
  if (!alive || ticket !== windowShiftRevision || selectedId.value !== conversation) return
  if (amount < 0) viewport.scrollTop = beforeTop + viewport.scrollHeight - beforeHeight
  else viewport.scrollTop = Math.max(0, beforeTop - (beforeHeight - viewport.scrollHeight))
  loadingOlder.value = false
}
async function navigateToMessageKey(key: string) {
  const targetId =
    timelineNodes.value.find((node) => node.key === key)?.id ??
    navigationNodes.value.find((item) => item.record.messageKey === key)?.record.messageId
  if (targetId && selectedBranchIds.value && !selectedBranchIds.value.has(targetId))
    releaseBranchFilter()
  const index = navigationNodes.value.findIndex((item) => item.record.messageKey === key)
  if (index < 0) {
    const summary = timelineNodes.value.find((node) => node.key === key)
    if (summary) await openMessage(summary.id, undefined, true)
    return
  }
  await navigateToNode(index)
}
async function navigateToNode(index: number) {
  const total = navigationNodes.value.length
  if (!total) return
  const safe = Math.max(0, Math.min(total - 1, index))
  const item = navigationNodes.value[safe]
  if (!item) return
  let turnIndex = filteredTurns.value.findIndex((turn) =>
    turn.messages.some((message) => message.record.messageKey === item.record.messageKey),
  )
  if (turnIndex < 0 && textSearch.value) {
    suppressSearchReset = true
    textSearch.value = ''
    await nextTick()
    suppressSearchReset = false
    turnIndex = filteredTurns.value.findIndex((turn) =>
      turn.messages.some((message) => message.record.messageKey === item.record.messageKey),
    )
  }
  if (turnIndex < 0) return
  explicitlyNavigatedTo = item.record.messageKey
  activeMessageKey.value = item.record.messageKey
  windowCenter.value = turnIndex
  await nextTick()
  const target = [
    ...(readingScroll.value?.querySelectorAll<HTMLElement>('[data-archive-node]') ?? []),
  ].find((x) => x.dataset.archiveNode === item.record.messageKey)
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' })
  else if (readingScroll.value) {
    const viewport = readingScroll.value
    viewport.scrollTop =
      (safe / Math.max(1, total - 1)) * (viewport.scrollHeight - viewport.clientHeight)
  }
  onReadingScroll()
}
watch(textSearch, () => {
  if (!suppressSearchReset) void resetReadingPosition()
})
watch(readingOrder, () => {
  if (requestedMessageId.value && !textSearch.value)
    void focusMessage(requestedMessageId.value).catch(() => undefined)
  else void resetReadingPosition()
})

watch(
  () => props.initialConversationId,
  (next) => {
    if (!next || next === selectedId.value || props.navigationTarget?.conversationId === next) return
    requestedLocation.value = null
    readSource.value = 'auto'
    readAccountId.value = null
    readRevision.value = null
    readInstanceId.value = null
    selectedId.value = next
    textSearch.value = ''
    void loadThread(next)
  },
)

async function loadThread(
  id: string | null,
  edge: 'first' | 'middle' | 'latest' = props.openPosition ?? 'latest',
  focusId: string | null = null,
) {
  cancelWindowWork()
  const revision = ++threadRevision
  const controller = new AbortController()
  windowController = controller
  requestedMessageId.value = focusId
  thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }
  activeMessageKey.value = null
  explicitlyNavigatedTo = null
  coverage.value = undefined
  visibleCount.value = ARCHIVE_INITIAL_TURNS
  windowCenter.value = null
  olderStoredCursor.value = null
  newerStoredCursor.value = null
  hasOlderStored.value = false
  hasNewerStored.value = false
  usingIndexedWindows.value = false
  knownStoredCount.value = 0
  hasUnsequencedRecords.value = false
  unsequencedTarget.value = false
  coverageLoading.value = false
  coverageError.value = false
  if (!id) {
    updateWorkspaceState(null)
    return
  }
  bindSourceChanges(id)
  threadLoading.value = true
  loadedEdge.value = edge
  error.value = false
  staleSavedWindow.value = false
  navigationError.value = null
  const owns = () =>
    alive && !controller.signal.aborted && revision === threadRevision && selectedId.value === id
  try {
    await paintLoadingStatus()
    if (!owns()) return
    const request = windowRequest(controller)
    const loaded =
      focusId && props.archiveAdapter.getMessageWindow
        ? await props.archiveAdapter.getMessageWindow(id, focusId, request)
        : edge === 'middle' && props.archiveAdapter.getPositionWindow
          ? await props.archiveAdapter.getPositionWindow(id, 'middle', request)
          : props.archiveAdapter.getThreadWindow
            ? await props.archiveAdapter.getThreadWindow(
                id,
                null,
                edge === 'first' ? 'first' : 'older',
                request,
              )
            : await props.archiveAdapter.getThread(id)
    if (!owns()) return
    if ('thread' in loaded) acceptWindow(loaded)
    else thread.value = loaded
    threadLoading.value = false
    if (focusId) await focusMessage(focusId)
    else {
      const middle =
        edge === 'middle'
          ? navigationNodes.value[Math.floor(navigationNodes.value.length / 2)]
          : undefined
      if (middle) await focusMessage(middle.record.messageId)
      else await resetReadingPosition(edge)
    }
    if (!owns() || workspaceState.value.loading) return
    // Coverage/header refresh may lag; it never gates displaying the bounded records.
    coverageLoading.value = true
    void props.archiveAdapter
      .getCoverage(id, windowRequest(controller))
      .then((value) => {
        if (owns()) coverage.value = value
      })
      .catch(() => {
        if (owns()) coverageError.value = true
      })
      .finally(() => {
        if (owns()) coverageLoading.value = false
      })
  } catch (cause) {
    if (owns()) describeReadFailure(cause)
  } finally {
    if (windowController === controller) windowController = undefined
    if (alive && revision === threadRevision) threadLoading.value = false
  }
}
function returnToLatest() {
  if (!selectedId.value) return
  textSearch.value = ''
  requestedLocation.value = null
  readRevision.value = null
  readInstanceId.value = null
  void loadThread(selectedId.value, 'latest')
}
function returnToFirstKnown() {
  if (!selectedId.value || !props.archiveAdapter.getThreadWindow) return
  textSearch.value = ''
  requestedLocation.value = null
  readRevision.value = null
  readInstanceId.value = null
  void loadThread(selectedId.value, 'first')
}
function select(id: string) {
  requestedLocation.value = null
  readSource.value = 'auto'
  readAccountId.value = null
  readRevision.value = null
  readInstanceId.value = null
  ++windowShiftRevision
  selectedId.value = id
  textSearch.value = ''
  void loadThread(id)
}
function showConversationList() {
  selectedId.value = null
  requestedLocation.value = null
  readSource.value = 'auto'
  readAccountId.value = null
  readRevision.value = null
  readInstanceId.value = null
  textSearch.value = ''
  versionsOpen.value = false
  inspectedVersionMessageId.value = null
  threadLoading.value = false
  sourceUnsubscribe?.()
  sourceUnsubscribe = undefined
  void loadThread(null)
}
async function refresh() {
  const revision = ++listRevision
  listLoading.value = true
  error.value = false
  // An archive read must not start under an unknown account. The observer's
  // verified account event will retry this read when the native client is ready.
  const owner = props.archiveAdapter.currentAccountId?.() ?? null
  accountPending.value = owner === null
  if (!owner) {
    navigationError.value = null
    staleSavedWindow.value = false
    listLoading.value = false
    return
  }
  let seededFromRam = false
  try {
    if (!initialized && !props.navigationTarget && props.initialConversationId) {
      const live = props.archiveAdapter.liveConversations?.() ?? []
      if (live.some((item) => item.conversationId === props.initialConversationId)) {
        conversations.value = [...live]
        selectedId.value = props.initialConversationId
        await loadThread(selectedId.value)
        seededFromRam = true
      }
    }
    const [cs, ps] = await readCatalog()
    if (!alive || revision !== listRevision) return
    if (props.archiveAdapter.currentAccountId?.() !== owner) return
    accountPending.value = false
    conversations.value = cs
    projects.value = ps
    if (!initialized) {
      if (props.navigationTarget) {
        selectedId.value = props.navigationTarget.conversationId
        requestedLocation.value = props.navigationTarget
      }
      if (
        !selectedId.value &&
        props.initialConversationId &&
        cs.some((chat) => chat.conversationId === props.initialConversationId)
      )
        selectedId.value = props.initialConversationId
      const projectId =
        props.initialProjectId ??
        cs.find((c) => c.conversationId === selectedId.value)?.projectId ??
        props.archiveAdapter.currentProjectId()
      expanded.value = new Set([projectId ?? NONE])
      initialized = true
    }
    const target = requestedLocation.value
    if (target && target.conversationId === selectedId.value) await openMessage(target.messageId, target)
    else if (!seededFromRam) await loadThread(selectedId.value)
  } catch (cause) {
    if (alive && revision === listRevision && !seededFromRam) describeReadFailure(cause)
  } finally {
    if (alive && revision === listRevision) listLoading.value = false
  }
}
function readCatalog() {
  return Promise.all([props.archiveAdapter.listConversations(), props.archiveAdapter.listProjects()])
}
const catalogRefresh = createArchiveRefreshQueue(async () => {
  const owner = props.archiveAdapter.currentAccountId?.()
  if (!owner) return
  const revision = listRevision
  const [items, namedProjects] = await readCatalog()
  if (!alive || revision !== listRevision || props.archiveAdapter.currentAccountId?.() !== owner) return
  conversations.value = items
  projects.value = namedProjects
})
onMounted(async () => {
  // Capture the live context before the asynchronous archive read. Navigation
  // during the initial read must not silently become the observer baseline.
  let owner = props.archiveAdapter.currentAccountId?.() ?? null
  let siteConversation = props.archiveAdapter.currentConversationId()
  const syncContext = () => {
    const nextOwner = props.archiveAdapter.currentAccountId?.() ?? null
    const previousSiteConversation = siteConversation
    siteConversation = props.archiveAdapter.currentConversationId()
    const display = props.archiveAdapter.currentConversationDisplay?.()
    if (display?.id !== siteDisplay.value?.id || display?.title !== siteDisplay.value?.title)
      siteDisplay.value = display
    if (nextOwner !== owner) {
      owner = nextOwner
      listRevision++
      cancelWindowWork()
      sourceUnsubscribe?.()
      sourceUnsubscribe = undefined
      conversations.value = []
      projects.value = []
      thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }
      coverage.value = undefined
      // An account switch invalidates in-flight archive reads, but is not
      // itself a rejected server history request.
      navigationError.value = null
      staleSavedWindow.value = false
      accountPending.value = nextOwner === null
      selectedId.value = null
      initialized = false
      if (nextOwner) void refresh().catch(() => undefined)
      return
    }
    // A reader on the live chat follows navigation. An explicitly opened
    // archive of another conversation or the archive catalog stays in place.
    if (
      nextOwner &&
      previousSiteConversation &&
      siteConversation !== previousSiteConversation &&
      selectedId.value === previousSiteConversation
    ) {
      if (siteConversation) select(siteConversation)
      else showConversationList()
    }
  }
  window.addEventListener(ARCHIVE_UPDATED_EVENT, catalogRefresh.request)
  // Subscribe BEFORE the initial asynchronous Reader request. Native ChatGPT
  // may confirm the account while that request is still pending.
  if (props.archiveAdapter.subscribeContextChange)
    contextUnsubscribe = props.archiveAdapter.subscribeContextChange(syncContext)
  else contextFallbackTimer = setInterval(syncContext, 450)
  await refresh()
  if (!alive) return
  if (alive) syncContext()
})
onBeforeUnmount(() => {
  alive = false
  branchRevision++
  cancelWindowWork()
  sourceUnsubscribe?.()
  liveRefresh.stop()
  catalogRefresh.stop()
  coverageRefresh.stop()
  timelineRefresh.stop()
  timelineRevision++
  versionRevision++
  listRevision++
  threadRevision++
  scrollRevision++
  windowShiftRevision++
  contextUnsubscribe?.()
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, catalogRefresh.request)
  if (readFocusFrame !== null) cancelAnimationFrame(readFocusFrame)
  if (contextFallbackTimer) clearInterval(contextFallbackTimer)
})
</script>

<template>
  <div class="booster-reader" :lang="locale" :class="{ 'booster-reader-list-mode': showingList }" :data-panel-content-focus="!showingList" :aria-busy="threadLoading || branchLoading">
    <header v-if="windowed || showingList || !selected" class="booster-section-header" :data-archive-drag-handle="windowed ? '' : undefined">
      <div class="booster-reader-heading">
        <GripHorizontal v-if="windowed" class="booster-archive-grip size-4" />
        <Database class="size-5" />
        <div><strong>{{ t('reader.title') }}</strong><p>{{ t('reader.readonly') }}</p></div>
      </div>
      <Button v-if="windowed && !showingList" variant="ghost" size="sm" type="button" @click="showConversationList"><ArrowLeft class="size-4" />{{ t('reader.back') }}</Button>
      <div class="booster-header-actions">
        <Popover v-if="!selected && $slots['collection-actions']">
          <PopoverTrigger as-child><Button variant="ghost" size="icon-sm" data-archive-collection-menu :aria-label="locale === 'ru' ? 'Сбор и сохранение' : 'Collection and saving'"><MoreHorizontal class="size-4" /></Button></PopoverTrigger>
          <PopoverContent class="booster-reader-action-menu"><slot name="collection-actions" /></PopoverContent>
        </Popover>
        <Button variant="outline" v-if="canReturnToExport" type="button" class="booster-action-secondary" @click="emit('returnExport')"><ArrowLeft class="size-4" />{{ t('reader.returnExport') }}</Button>
        <TooltipHint :label="t('reader.refresh')"><Button variant="ghost" size="icon-sm" type="button" class="booster-icon-button" :disabled="listLoading" :aria-label="t('reader.refresh')" @click="retryLocation"><RefreshCw class="size-4" /></Button></TooltipHint>
        <TooltipHint v-if="windowed" :label="t('reader.minimize')"><Button variant="ghost" size="icon-sm" type="button" class="booster-icon-button" :aria-label="t('reader.minimize')" @click="emit('minimize')"><Minus class="size-4" /></Button></TooltipHint>
        <TooltipHint :label="t('reader.close')"><Button variant="ghost" size="icon-sm" type="button" class="booster-icon-button" :aria-label="t('reader.close')" @click="emit('close')"><X class="size-4" /></Button></TooltipHint>
      </div>
    </header>
    <p v-if="workspaceState.loading || workspaceState.failed" role="status" class="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
      <LoaderCircle v-if="workspaceState.loading" class="size-3 animate-spin" />
      {{ workspaceState.failed ? (locale === 'ru' ? 'Не удалось догрузить архив. Нажмите «Обновить».' : 'Could not finish loading the archive. Select Refresh to retry.') : (locale === 'ru' ? 'Загружаем историю' : 'Loading history') }}
      <span v-if="workspaceState.loading">· {{ locale === 'ru' ? 'Загружено' : 'Loaded' }} {{ workspaceState.loaded }}</span>
    </p>

    <p v-if="accountPending" role="status" class="booster-note">{{ locale === 'ru'
      ? 'Ожидание подтверждения аккаунта ChatGPT…'
      : 'Waiting for ChatGPT account verification…' }}</p>
    <div class="booster-reader-layout">
      <ArchiveConversationList v-show="showingList" v-model:search="search" :groups="groups" :selected-id="selectedId"
        :expanded-ids="expanded" :conversation-count="conversations.length" :loading="listLoading"
        :copy="{ search: t('reader.search'), loading: t('reader.loading'), empty: emptyArchiveMessage,
          noResults: t('reader.noResults'), untitled: t('identity.untitled'), missingBranch: t('reader.branchMissing') }"
        @toggle="toggleGroup" @select="select">
        <template #group-action="{ group }"><CopyIdentity v-if="group.id !== NONE" label="" :identifier="group.id" :locale="locale" /></template>
      </ArchiveConversationList>

      <main v-show="!showingList" class="booster-reader-main">
        <div class="booster-reader-pinned">
          <template v-if="selected">
            <header class="booster-reader-chat-header">
              <div class="booster-reader-chat-identity">
                <Button v-if="!windowed" variant="ghost" size="icon-sm" :aria-label="t('reader.back')" @click="showConversationList"><ArrowLeft class="size-4" /></Button>
                <h2><span v-if="selected.projectId" class="booster-reader-project-label">{{ projectLabel(selected.projectId) }} / </span><CopyIdentity :label="selected.title || t('identity.untitled')" :identifier="selected.conversationId" :locale="locale" /></h2>
                <p v-if="selected.branchSourceConversationId" class="booster-note">
                  <CopyIdentity :label="t('reader.branch') + ': ' + (selected.branchSourceTitle || t('identity.untitled'))" :identifier="selected.branchSourceConversationId" :locale="locale" />
                </p>
              </div>
            <div class="booster-reader-chat-actions">
              <TooltipHint :label="t('reader.searchMessages')"><Button variant="ghost" size="icon-sm" :aria-label="t('reader.searchMessages')" :aria-pressed="searchOpen" @click="searchOpen = !searchOpen"><Search class="size-4" /></Button></TooltipHint>
              <Button variant="outline" class="booster-action-secondary booster-reader-export" type="button" :disabled="threadLoading || knownRecordCount === 0" @click="emit('export', selected.conversationId, selected.title, selectedMessages.size ? [...selectedMessages] : selectedBranchIds ? [...selectedBranchIds] : undefined)"><Download class="size-4" />{{ selectedMessages.size ? t('reader.export') + ' · ' + selectedMessages.size : selectedBranchTip ? (locale === 'ru' ? 'Экспорт ветки' : 'Export branch') : t('reader.export') }}</Button>

              <ArchiveReaderActions ref="readerActions" v-model:open="toolsOpen" v-model:service-records="showServiceRecords"
                :locale="locale" :has-branches="Boolean(storedBranches.length)"
                :selection-enabled="selectionEnabled" :can-start-range="Boolean(archiveAdapter.getRangeMessageIds && focusedMessageId)"
                :has-range-start="Boolean(rangeStart)" :can-end-range="Boolean(focusedMessageId)" :range-loading="rangeLoading"
                :has-integrity="Boolean(coverage?.integrity)" :version-count="archiveAdapter.getMessageVersions && versionMessageId ? sourceVersions.length : null"
                @branches="navigationOpen = true" @toggle-selection="selectionEnabled = !selectionEnabled"
                @start-range="rangeStart = focusedMessageId; rangeEnd = null" @end-range="endRange"
                @details="revealReaderDetails">
                <template v-if="$slots['collection-actions']" #default><slot name="collection-actions" /></template>
              </ArchiveReaderActions>
            </div>
            </header>
            <p v-if="rangeStart" class="text-xs text-muted-foreground">{{ locale === 'ru' ? 'Диапазон сохранённых записей' : 'Saved record range' }}: {{ rangeStart.slice(0, 12) }} → {{ rangeEnd?.slice(0, 12) || '…' }}<span v-if="rangeEnd"> · {{ selectedMessages.size }}</span></p>
            <div v-if="searchOpen" class="booster-reader-find">
              <Input v-model="textSearch" type="search" :placeholder="t('reader.searchMessages')" :aria-label="t('reader.searchMessages')"  />
              <p v-if="usingIndexedWindows && (hasOlderStored || hasNewerStored || knownStoredCount > thread.recordCount)" class="booster-note">{{ t('reader.windowSearchOnly') }}</p>
            </div>
            <div class="booster-reader-summary">
              <span>{{ locale === 'ru' ? 'Всего записей' : 'Total records' }}: {{ knownRecordCount }}</span>
              <span v-if="usingIndexedWindows && thread.recordCount < knownRecordCount">{{ locale === 'ru' ? 'В окне' : 'In window' }}: {{ thread.recordCount }}</span>
              <ArchiveIntegrityIndicator :integrity="coverage?.readerIntegrity ?? coverage?.integrity" :complete="coverage?.completeAtLastRead" :has-older-history="coverage?.hasOlderServerHistory" :loading="coverageLoading || workspaceState.loading" :error="coverageError" :locale="locale" @details="showIntegrityFromIndicator" />
              <Button v-if="selectedBranchTip" variant="ghost" size="sm" class="h-7 px-1 text-xs" @click="releaseBranchFilter()">{{ locale === 'ru' ? 'Выбрана ветка · показать все' : 'Branch selected · show all' }}</Button>
              <div class="booster-reader-position-actions" role="group" :aria-label="locale === 'ru' ? 'Навигация по архиву' : 'Archive navigation'">
                <ArchiveReaderNavigation vertical
                  :first-label="locale === 'ru' ? 'К началу' : 'First'"
                  :last-label="locale === 'ru' ? 'К концу' : 'Latest'"
                  :first-hint="locale === 'ru' ? 'К первому сохранённому сообщению' : 'First saved message'"
                  :last-hint="locale === 'ru' ? 'К последнему сохранённому сообщению' : 'Last saved message'"
                  :disabled="threadLoading || loadingOlder" @first="returnToFirstKnown" @last="returnToLatest" />
                <TooltipHint v-if="timelineNodes.length || navigationNodes.length" :label="historyOpen ? (locale === 'ru' ? 'Скрыть таймлайн' : 'Hide timeline') : (locale === 'ru' ? 'Показать таймлайн' : 'Show timeline')">
                  <Button ref="timelineToggle" type="button" :variant="historyOpen ? 'secondary' : 'ghost'" size="icon-sm" class="size-7" :aria-label="locale === 'ru' ? 'Таймлайн' : 'Timeline'" :aria-pressed="historyOpen" @click="historyOpen = !historyOpen"><ListTree class="size-4" /></Button>
                </TooltipHint>
              </div>
            </div>
          </template>
        </div>

        <p v-if="staleSavedWindow" role="alert" class="booster-error">
          {{ t('reader.staleWindow') }}
          <Button variant="outline" type="button" class="booster-action-secondary" @click="retryLocation">{{ t('reader.reopenCurrentCopy') }}</Button>
        </p>
        <p v-if="navigationError" role="alert" class="booster-error">{{ t(navigationError) }}</p>
        <p v-if="error" role="alert" class="booster-error">{{ t('reader.error') }}</p>
        <ArchiveReadingSurface compact-timeline :timeline-visible="Boolean(historyOpen && selected && (timelineNodes.length || navigationNodes.length))">
          <template #status><div v-if="loadingOlder" class="booster-reader-older-loading" role="status" aria-live="polite"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t(loadingDirection === 'newer' ? 'reader.loadingNewer' : 'reader.loadingEarlier') }} · {{ displayedTurns.length }}/{{ filteredTurns.length }}</div></template>
          <template #timeline><ArchiveFlowGraph v-if="selected"
            :key="selectedId ?? ''" :thread="thread" :locale="locale" :active-key="activeMessageKey"
            :timeline="timelineNodes" :selected-message-ids="selectedMessages" :loading="threadLoading"
            @navigate="navigateToMessageKey" @close="closeHistory" /></template>
          <div ref="readingScroll" class="booster-reader-scroll" @scroll.passive="onReadingScroll" @wheel.passive="readerScroll.onUserInput" @touchmove.passive="readerScroll.onUserInput" @pointerdown="readerScroll.onUserInput" @pointermove.passive="readerScroll.onUserInput" @keydown="readerScroll.onUserInput">
            <p v-if="historyOpen && !timelineNodes.length && usingIndexedWindows && (hasOlderStored || hasNewerStored || knownStoredCount > thread.recordCount)" class="booster-note">{{ t('reader.windowGraphOnly') }}</p>
            <div v-if="threadLoading" role="status" class="space-y-4 p-4" :aria-label="t('reader.loading')"><div class="flex items-center justify-between gap-2"><span class="text-sm text-muted-foreground">{{ t('reader.loading') }}</span><Button variant="outline" type="button" @click="cancelNavigation">{{ t('reader.cancelNavigation') }}</Button></div><div v-for="index in 3" :key="index" class="space-y-2"><Skeleton class="h-4 w-1/3" /><Skeleton class="h-24 w-full" /><Skeleton class="h-4 w-2/3" /></div></div>
            <template v-else-if="selected">
              <div class="booster-reader-exchanges">
                <p v-if="!filteredTurns.length && !error && !navigationError" class="booster-note">{{ t(textSearch.trim() ? 'reader.noResults' : thread.recordCount ? 'reader.noVisibleRecords' : 'reader.emptyConversation') }}</p>
                <article v-for="turn in displayedTurns" :key="turn.id" class="booster-exchange">
                  <p v-if="turn.association === 'unassigned'" class="booster-note">{{ t('reader.unassigned') }}</p>
                  <p v-else-if="turn.association === 'adjacency'" class="booster-note">{{ t('reader.adjacency') }}</p>
                  <ArchiveRecordList :records="turn.messages.filter(i => i.kind === 'user')" :record-key="itemKey" :message-id="itemMessageId" :target-message-id="requestedMessageId"
                    :selectable="selectionEnabled" :selected-ids="selectedMessages" :selection-label="itemSelectionLabel" @select="selectMessage">
                    <template #record="{ record }"><ArchiveRecord :item="record" :locale="locale" :focused="requestedMessageId === record.record.messageId" /></template>
                  </ArchiveRecordList>
                  <Collapsible v-if="turn.details.length" class="booster-exchange-details">
                    <CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="text-xs text-muted-foreground">{{ showServiceRecords ? t('reader.details') : (locale === 'ru' ? 'Действия ассистента' : 'Assistant activity') }} · {{ turn.details.length }}</Button></CollapsibleTrigger><CollapsibleContent>
                    <ArchiveRecordList :records="turn.details" :record-key="itemKey" :message-id="itemMessageId" :target-message-id="requestedMessageId"
                    :selectable="selectionEnabled" :selected-ids="selectedMessages" :selection-label="itemSelectionLabel" @select="selectMessage">
                    <template #record="{ record }"><ArchiveRecord :item="record" :locale="locale" :focused="requestedMessageId === record.record.messageId" /></template>
                  </ArchiveRecordList>
                  </CollapsibleContent></Collapsible>
                  <ArchiveRecordList :records="turn.messages.filter(i => i.kind !== 'user')" :record-key="itemKey" :message-id="itemMessageId" :target-message-id="requestedMessageId"
                    :selectable="selectionEnabled" :selected-ids="selectedMessages" :selection-label="itemSelectionLabel" @select="selectMessage">
                    <template #record="{ record }"><ArchiveRecord :item="record" :locale="locale" :focused="requestedMessageId === record.record.messageId" /></template>
                  </ArchiveRecordList>
                </article>
              </div>
            </template>
            <p v-else-if="!listLoading" class="booster-note">{{ t('reader.missing') }}</p>
          </div>
        </ArchiveReadingSurface>
      </main>
    </div>

    <ArchiveReaderDialog v-model:open="navigationOpen" :title="t('reader.branchesTitle')" :description="t('reader.branchesDescription')" @close-auto-focus="restoreToolsFocus">
            <div v-if="coverage?.integrity && archiveAdapter.getBranchPath && storedBranches.length" class="booster-reader-branch-navigation">
              <Label class="booster-reader-path-select">{{ locale === 'ru' ? 'Ветка диалога' : 'Conversation branch' }}
                <Select :model-value="selectedBranchTip ?? '__all__'" :disabled="branchLoading || threadLoading" @update:model-value="chooseBranch(String($event) === '__all__' ? '' : String($event)); navigationOpen = false"><SelectTrigger class="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="__all__">{{ locale === 'ru' ? 'Весь диалог' : 'Entire conversation' }}</SelectItem>
                  <SelectItem v-for="(tipId, index) in coverage.integrity.tips" :key="tipId" :value="tipId">{{ locale === 'ru' ? 'Ветка' : 'Branch' }} {{ index + 1 }} {{ locale === 'ru' ? 'из' : 'of' }} {{ coverage.integrity.tips.length }} · {{ branchPreview(tipId) }}</SelectItem>
                </SelectContent></Select>
              </Label>
            </div>
      <p v-if="!storedBranches.length" class="text-sm text-muted-foreground">{{ locale === 'ru' ? 'В этом диалоге нет сохранённых веток.' : 'This conversation has no saved branches.' }}</p>
    </ArchiveReaderDialog>
    <ArchiveReaderDialog v-if="coverage?.integrity" v-model:open="integrityOpen" :title="t('reader.integrityTitle')" :description="t('reader.integrityDescription')" @close-auto-focus="restoreIntegrityFocus">
      <p v-if="coverage.exhaustedAt" class="text-sm text-muted-foreground">{{ locale === 'ru' ? 'Достигнут лимит чата. Отметка завершения сохранена и не заменяется при обновлении истории.' : 'Conversation limit reached. The terminal marker is retained across history refreshes.' }}</p>
      <p v-if="coverage.integrity.scope === 'current-native-graph'" class="text-sm text-muted-foreground">{{ locale === 'ru' ? `Проверен полный граф текущей беседы от ChatGPT. Исторических записей вне этого графа: ${coverage.integrity.retainedOutsideGraph ?? 0}. Они сохранены отдельно; их связи этим ответом не подтверждаются.` : `Verified the complete current conversation graph returned by ChatGPT. Historical records outside this graph: ${coverage.integrity.retainedOutsideGraph ?? 0}. They are retained; this response does not verify their relationships.` }}</p>
      <ArchiveIntegrityDetails :integrity="coverage.readerIntegrity ?? coverage.integrity" :service-issues="coverage.serviceIssues" :complete="coverage.completeAtLastRead" :locale="locale" @inspect="inspectMessage">
        <template v-if="selectedId === archiveAdapter.currentConversationId()" #actions>
          <div class="space-y-2">
            <ConversationCollectionAction :label="locale === 'ru' ? 'Собрать историю' : 'Collect history'" :busy="recovering" :stop-label="locale === 'ru' ? 'Остановить' : 'Stop'" @start="recoverHistory" @stop="stopRecovery" />
            <p v-if="recovering" role="status" class="text-xs text-muted-foreground">{{ locale === 'ru' ? 'Читаем и сохраняем историю…' : 'Reading and saving history…' }} {{ recoveryState?.pagesLoaded ?? 0 }}</p>
            <p v-if="recoveryError || (recoveryState?.conversationId === selectedId && recoveryState?.phase === 'error')" role="alert" class="text-sm text-destructive">{{ locale === 'ru' ? 'Не удалось завершить сбор. Сохранённые сообщения остаются в архиве.' : 'Collection could not finish. Saved messages remain in the archive.' }}</p>
          </div>
        </template>
      </ArchiveIntegrityDetails>
    </ArchiveReaderDialog>
    <ArchiveReaderDialog v-if="versionMessageId" v-model:open="versionsOpen" :title="t('reader.versionsTitle')" :description="t('reader.versionsDescription')" :data-version-message="versionMessageId" wide @close-auto-focus="restoreToolsFocus">
              <Label>{{ locale === 'ru' ? 'Сохранённая версия сообщения' : 'Saved message version' }}
                <Select :model-value="String(selectedVersion)" @update:model-value="selectedVersion = Number($event)"><SelectTrigger class="w-full"><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem v-for="(version, index) in sourceVersions" :key="index" :value="String(index)">{{ index + 1 }} · {{ new Date(version.observedAtMs).toLocaleString(locale) }} · {{ evidenceLabel(version.decision) }}</SelectItem>
                </SelectContent></Select></Label>
              <p class="booster-note">{{ locale === 'ru' ? 'Переключение меняет только локальный просмотр. Исходные варианты и данные ChatGPT сохраняются.' : 'Selection changes local inspection only. All source variants and native ChatGPT data remain preserved.' }}</p>
              <p v-if="versionError" role="alert" class="booster-error">{{ locale === 'ru' ? 'Не удалось открыть версии' : 'Could not open versions' }}</p>
              <Skeleton v-if="versionsLoading" class="h-20 w-full" />
              <ArchiveRecord v-for="item in versionItems" :key="item.record.messageKey + ':' + selectedVersion" :item="item" :locale="locale" :expand-reasoning="true" :focused="true" />
    </ArchiveReaderDialog>

  </div>
</template>
