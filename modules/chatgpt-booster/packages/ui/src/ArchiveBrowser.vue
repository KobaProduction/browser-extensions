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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
} from '@kobaproduction/browser-ui'
import {
  ArchiveConversationList,
  ArchiveReadingSurface,
  ArchiveRecordList,
  createArchiveReadingScroll,
} from '@kobaproduction/browser-widgets'
import ArrowLeft from 'lucide-vue-next/dist/esm/icons/arrow-left.js'
import Brain from 'lucide-vue-next/dist/esm/icons/brain.js'
import Database from 'lucide-vue-next/dist/esm/icons/database.js'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import MoreHorizontal from 'lucide-vue-next/dist/esm/icons/ellipsis.js'
import GitBranch from 'lucide-vue-next/dist/esm/icons/git-branch.js'
import GripHorizontal from 'lucide-vue-next/dist/esm/icons/grip-horizontal.js'
import Info from 'lucide-vue-next/dist/esm/icons/info.js'
import LoaderCircle from 'lucide-vue-next/dist/esm/icons/loader-circle.js'
import Minus from 'lucide-vue-next/dist/esm/icons/minus.js'
import RefreshCw from 'lucide-vue-next/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-vue-next/dist/esm/icons/search.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveFlowGraph from './ArchiveFlowGraph.vue'
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
const messageLookup = ref('')
const messageLookupOpen = ref(false)
const readSource = ref<'auto' | 'live' | 'saved'>('auto')
const readAccountId = ref<string | null>(null)
const readRevision = ref<number | null>(null)
const readInstanceId = ref<string | null>(null)
const unsequencedTarget = ref(false)
const requestedLocation = ref<ArchiveMessageLocation | null>(null)
let windowController: AbortController | undefined
let sourceUnsubscribe: (() => void) | undefined
let interruptedLoad = false
const mobileList = ref(!props.initialConversationId)
const search = ref('')
const textSearch = ref('')
const visibleCount = ref(ARCHIVE_INITIAL_TURNS)
const readingOrder = ref<ArchiveReadingOrder>('chronological')
const searchOpen = ref(false)
const toolsOpen = ref(false)
const toolsPage = ref<'main' | 'display' | 'advanced'>('main')
watch(toolsOpen, (open) => {
  if (open) toolsPage.value = 'main'
})
function openToolsPage(page: 'main' | 'display' | 'advanced', event: Event) {
  const panel = (event.currentTarget as HTMLElement).closest('.booster-reader-action-menu')
  toolsPage.value = page
  void nextTick(() => panel?.querySelector<HTMLButtonElement>('button')?.focus())
}
const historyOpen = ref(false)
const historyToggle = ref<{ $el: HTMLElement } | null>(null)
function closeHistory() {
  historyOpen.value = false
  void nextTick(() => {
    const button = historyToggle.value?.$el
    if (button instanceof HTMLElement) button.focus({ preventScroll: true })
  })
}
const timelineNodes = ref<Awaited<ReturnType<NonNullable<ArchiveDataAdapter['getTimeline']>>>>([])
let timelineRevision = 0
let timelineConversationId: string | null = null
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
    branchRevision++
    branchLoading.value = false
    toolsOpen.value = false
    timelineNodes.value = []
    timelineConversationId = null
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
      timelineConversationId = id
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
const navigationOpen = ref(false)
const showServiceRecords = ref(false)
function revealReaderDetails(kind: 'integrity' | 'versions') {
  toolsOpen.value = false
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
  void nextTick(() => {
    const element = historyToggle.value?.$el
    if (element instanceof HTMLElement) element.focus({ preventScroll: true })
  })
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
const timelineRefresh = createArchiveRefreshQueue(async () => {
  const id = selectedId.value
  if (id) await loadTimeline(id)
})
function updateWorkspaceState(id: string) {
  workspaceState.value = props.archiveAdapter.workspaceStatus?.(id) ?? {
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
const hasUnsequencedRecords = ref(false)
const readingScroll = ref<HTMLElement | null>(null)
const activeMessageKey = ref<string | null>(null)
const expanded = ref(new Set<string>())
const reasoningExpanded = ref(false)
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
const selected = computed(
  () =>
    conversations.value.find((conversation) => conversation.conversationId === selectedId.value) ??
    (selectedId.value
      ? {
          conversationId: selectedId.value,
          projectId: null,
          title: null,
          branchSourceConversationId: null,
          branchSourceTitle: null,
        }
      : undefined),
)
const projectLabel = (id: string | null) =>
  id
    ? projects.value.find((project) => project.projectId === id)?.title || t('identity.unknownProject')
    : t('reader.noProject')

const groups = computed(() => {
  const byProject = new Map<string, ArchiveConversationView[]>()
  for (const conversation of conversations.value) {
    const key = conversation.projectId ?? NONE
    const group = byProject.get(key) ?? []
    group.push(conversation)
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
    const stats = await props.archiveAdapter.getCoverage(id)
    if (!alive || selectedId.value !== id || revision !== threadRevision) return
    coverage.value = stats
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
  mobileList.value = false
  requestedMessageId.value = messageId.trim()
  messageLookup.value = messageId.trim()
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
function lookupMessage() {
  void openMessage(messageLookup.value)
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
      liveRefresh.request()
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
    mobileList.value = false
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
  if (!id) return
  if (timelineConversationId !== id) void loadTimeline(id)
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
    if (!owns()) return
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
function returnToMiddle() {
  if (!selectedId.value || !props.archiveAdapter.getPositionWindow) return
  textSearch.value = ''
  requestedLocation.value = null
  readRevision.value = null
  readInstanceId.value = null
  void loadThread(selectedId.value, 'middle')
}
function select(id: string) {
  requestedLocation.value = null
  readSource.value = 'auto'
  readAccountId.value = null
  readRevision.value = null
  readInstanceId.value = null
  ++windowShiftRevision
  selectedId.value = id
  mobileList.value = false
  textSearch.value = ''
  void loadThread(id)
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
    const [cs, ps] = await Promise.all([
      props.archiveAdapter.listConversations(),
      props.archiveAdapter.listProjects(),
    ])
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
      if (!selectedId.value)
        selectedId.value =
          (props.initialProjectId
            ? cs.find((chat) => chat.projectId === props.initialProjectId)?.conversationId
            : cs[0]?.conversationId) ?? null
      const projectId =
        props.initialProjectId ??
        cs.find((c) => c.conversationId === selectedId.value)?.projectId ??
        props.archiveAdapter.currentProjectId()
      expanded.value = new Set([projectId ?? NONE])
      initialized = true
    }
    const target = requestedLocation.value
    if (target && target.conversationId === selectedId.value) await openMessage(target.messageId, target)
    else await loadThread(selectedId.value)
  } catch (cause) {
    if (alive && revision === listRevision && !seededFromRam) describeReadFailure(cause)
  } finally {
    if (alive && revision === listRevision) listLoading.value = false
  }
}
async function refreshConversationTitles() {
  const owner = props.archiveAdapter.currentAccountId?.()
  const revision = listRevision
  try {
    const items = await props.archiveAdapter.listConversations()
    if (alive && revision === listRevision && props.archiveAdapter.currentAccountId?.() === owner)
      conversations.value = items
  } catch {
    // The current reader stays usable when catalog refresh fails.
  }
}
onMounted(async () => {
  // Capture the live context before the asynchronous archive read. Navigation
  // during the initial read must not silently become the observer baseline.
  let current = props.archiveAdapter.currentConversationId()
  const initialWorkspace = props.initialConversationId ?? current
  let owner = props.archiveAdapter.currentAccountId?.() ?? null
  if (initialWorkspace && owner) props.archiveAdapter.retryWorkspace?.(initialWorkspace)
  const syncContext = () => {
    const next = props.archiveAdapter.currentConversationId()
    const nextOwner = props.archiveAdapter.currentAccountId?.() ?? null
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
      current = next
      if (nextOwner) void refresh().catch(() => undefined)
      return
    }
    if (next === current) return
    current = next
    inspectedVersionMessageId.value = null
    versionsOpen.value = false
    if (!next || readSource.value === 'saved') return
    const conversation = conversations.value.find((item) => item.conversationId === next)
    selectedId.value = next
    if (conversation) expanded.value = new Set([conversation.projectId ?? NONE])
    textSearch.value = ''
    void loadThread(next)
  }
  window.addEventListener(ARCHIVE_UPDATED_EVENT, refreshConversationTitles)
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
  timelineRefresh.stop()
  timelineRevision++
  versionRevision++
  listRevision++
  threadRevision++
  scrollRevision++
  windowShiftRevision++
  contextUnsubscribe?.()
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, refreshConversationTitles)
  if (readFocusFrame !== null) cancelAnimationFrame(readFocusFrame)
  if (contextFallbackTimer) clearInterval(contextFallbackTimer)
})
</script>

<template>
  <div class="booster-reader" :lang="locale" :class="{ 'booster-reader-list-mode': mobileList }" :data-panel-content-focus="!mobileList" :aria-busy="threadLoading || branchLoading">
    <header v-if="windowed || mobileList || !selected" class="booster-section-header" :data-archive-drag-handle="windowed ? '' : undefined">
      <div class="booster-reader-heading">
        <GripHorizontal v-if="windowed" class="booster-archive-grip size-4" />
        <Database class="size-5" />
        <div><strong>{{ t('reader.title') }}</strong><p>{{ t('reader.readonly') }}</p></div>
      </div>
      <Button v-if="!mobileList" variant="ghost" class="booster-mobile-back" type="button" @click="mobileList = true"><ArrowLeft class="size-4" />{{ t('reader.back') }}</Button>
      <div class="booster-header-actions">
        <Popover v-if="!selected && $slots['collection-actions']">
          <PopoverTrigger as-child><Button variant="ghost" size="icon-sm" :aria-label="locale === 'ru' ? 'Сбор и сохранение' : 'Collection and saving'"><MoreHorizontal class="size-4" /></Button></PopoverTrigger>
          <PopoverContent class="booster-reader-action-menu"><slot name="collection-actions" /></PopoverContent>
        </Popover>
        <Button variant="outline" v-if="canReturnToExport" type="button" class="booster-action-secondary" @click="emit('returnExport')"><ArrowLeft class="size-4" />{{ t('reader.returnExport') }}</Button>
        <Button variant="ghost" size="icon-sm" type="button" class="booster-icon-button" :disabled="listLoading" :title="t('reader.refresh')" :aria-label="t('reader.refresh')" @click="retryLocation"><RefreshCw class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" v-if="windowed" type="button" class="booster-icon-button" :title="t('reader.minimize')" :aria-label="t('reader.minimize')" @click="emit('minimize')"><Minus class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" type="button" class="booster-icon-button" :aria-label="t('reader.close')" @click="emit('close')"><X class="size-4" /></Button>
      </div>
    </header>
    <p v-if="workspaceState.loading || workspaceState.failed" role="status" class="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
      <LoaderCircle v-if="workspaceState.loading" class="size-3 animate-spin" />
      {{ workspaceState.failed ? (locale === 'ru' ? 'Не удалось догрузить сохранённые данные. Повторите открытие архива.' : 'Saved data could not be loaded. Reopen the archive to retry.') : (locale === 'ru' ? 'Загрузка в workspace' : 'Loading workspace') }}
      <span v-if="workspaceState.loading">· {{ workspaceState.loaded }} · {{ locale === 'ru' ? 'Не найдено родителей' : 'Missing parents' }}: {{ workspaceState.missingParents }}</span>
    </p>

    <p v-if="accountPending" role="status" class="booster-note">{{ locale === 'ru'
      ? 'Ожидание подтверждения аккаунта ChatGPT…'
      : 'Waiting for ChatGPT account verification…' }}</p>
    <div class="booster-reader-layout">
      <ArchiveConversationList v-model:search="search" :groups="groups" :selected-id="selectedId"
        :expanded-ids="expanded" :conversation-count="conversations.length" :loading="listLoading"
        :copy="{ search: t('reader.search'), loading: t('reader.loading'), empty: emptyArchiveMessage,
          noResults: t('reader.noResults'), untitled: t('identity.untitled'), missingBranch: t('reader.branchMissing') }"
        @toggle="toggleGroup" @select="select">
        <template #group-action="{ group }"><CopyIdentity v-if="group.id !== NONE" label="" :identifier="group.id" :locale="locale" /></template>
      </ArchiveConversationList>

      <main class="booster-reader-main">
        <div class="booster-reader-pinned">
          <template v-if="selected">
            <header class="booster-reader-chat-header">
              <div class="booster-reader-chat-identity">
                <Button v-if="!mobileList" variant="ghost" size="icon-sm" class="booster-mobile-back" :aria-label="t('reader.back')" @click="mobileList = true"><ArrowLeft class="size-4" /></Button>
                <h2><span v-if="selected.projectId" class="booster-reader-project-label">{{ projectLabel(selected.projectId) }} / </span><CopyIdentity :label="selected.title || t('identity.untitled')" :identifier="selected.conversationId" :locale="locale" /></h2>
                <p v-if="selected.branchSourceConversationId" class="booster-note">
                  <CopyIdentity :label="t('reader.branch') + ': ' + (selected.branchSourceTitle || t('identity.untitled'))" :identifier="selected.branchSourceConversationId" :locale="locale" />
                </p>
              </div>
            <div class="booster-reader-chat-actions">
              <Button variant="ghost" size="icon-sm" :aria-label="t('reader.searchMessages')" :title="t('reader.searchMessages')" :aria-pressed="searchOpen" @click="searchOpen = !searchOpen"><Search class="size-4" /></Button>
              <Button variant="outline" class="booster-action-secondary booster-reader-export" type="button" @click="emit('export', selected.conversationId, selected.title, selectedMessages.size ? [...selectedMessages] : selectedBranchIds ? [...selectedBranchIds] : undefined)"><Download class="size-4" />{{ selectedMessages.size ? t('reader.export') + ' · ' + selectedMessages.size : selectedBranchTip ? (locale === 'ru' ? 'Экспорт ветки' : 'Export branch') : t('reader.export') }}</Button>

              <Popover v-model:open="toolsOpen">
                <PopoverTrigger as-child><Button ref="historyToggle" variant="ghost" size="icon-sm" type="button" class="booster-reader-tools-toggle" :aria-label="locale === 'ru' ? 'Действия с архивом' : 'Archive actions'"><MoreHorizontal class="size-4" /></Button></PopoverTrigger>
                <PopoverContent align="end" class="booster-reader-action-menu p-1" :aria-label="locale === 'ru' ? 'Действия с архивом' : 'Archive actions'">
                  <template v-if="toolsPage === 'main'">
                    <Button variant="ghost" size="sm" @click="navigationOpen = true; toolsOpen = false"><GitBranch class="size-4" />{{ locale === 'ru' ? 'Ветки и переходы' : 'Branches and navigation' }}</Button>
                    <Button variant="ghost" size="sm" :aria-pressed="selectionEnabled" @click="selectionEnabled = !selectionEnabled; toolsOpen = false"><GripHorizontal class="size-4" />{{ selectionEnabled ? (locale === 'ru' ? 'Завершить выбор' : 'Finish selecting') : (locale === 'ru' ? 'Выбрать сообщения' : 'Select messages') }}</Button>
                    <template v-if="selectionEnabled">
                      <Button v-if="archiveAdapter.getRangeMessageIds && focusedMessageId" variant="ghost" size="sm" :disabled="rangeLoading" @click="rangeStart = focusedMessageId; rangeEnd = null; toolsOpen = false">{{ locale === 'ru' ? 'Начать диапазон здесь' : 'Start range here' }}</Button>
                      <Button v-if="rangeStart" variant="ghost" size="sm" :disabled="rangeLoading || !focusedMessageId" @click="endRange(); toolsOpen = false">{{ locale === 'ru' ? 'Закончить диапазон здесь' : 'End range here' }}</Button>
                    </template>
                    <div v-if="$slots['collection-actions']" class="booster-reader-menu-group"><slot name="collection-actions" /></div>
                    <div class="booster-reader-menu-group">
                      <Button variant="ghost" size="sm" @click="openToolsPage('display', $event)"><Brain class="size-4" />{{ locale === 'ru' ? 'Отображение' : 'Display' }}<span class="ms-auto" aria-hidden="true">›</span></Button>
                      <Button variant="ghost" size="sm" @click="openToolsPage('advanced', $event)"><Info class="size-4" />{{ locale === 'ru' ? 'Диагностика' : 'Diagnostics' }}<span class="ms-auto" aria-hidden="true">›</span></Button>
                    </div>
                  </template>
                  <template v-else>
                    <Button variant="ghost" size="sm" @click="openToolsPage('main', $event)"><ArrowLeft class="size-4" />{{ locale === 'ru' ? 'Назад' : 'Back' }}</Button>
                    <p class="px-2 py-1 text-xs text-muted-foreground">{{ toolsPage === 'display' ? (locale === 'ru' ? 'Отображение' : 'Display') : (locale === 'ru' ? 'Диагностика' : 'Diagnostics') }}</p>
                    <template v-if="toolsPage === 'display'">
                      <Button v-if="timelineNodes.length || navigationNodes.length" variant="ghost" size="sm" :aria-pressed="historyOpen" @click="historyOpen = !historyOpen; toolsOpen = false"><GitBranch class="size-4" />{{ historyOpen ? (locale === 'ru' ? 'Скрыть таймлайн' : 'Hide timeline') : (locale === 'ru' ? 'Показать таймлайн' : 'Show timeline') }}</Button>
                      <Button variant="ghost" size="sm" @click="reasoningExpanded = !reasoningExpanded; toolsOpen = false"><Brain class="size-4" />{{ t(reasoningExpanded ? 'reader.collapseReasoning' : 'reader.expandReasoning') }}</Button>
                      <Button variant="ghost" size="sm" :aria-pressed="showServiceRecords" @click="showServiceRecords = !showServiceRecords; toolsOpen = false"><Database class="size-4" />{{ showServiceRecords ? (locale === 'ru' ? 'Скрыть служебные записи' : 'Hide service records') : (locale === 'ru' ? 'Показать служебные записи' : 'Show service records') }}</Button>
                    </template>
                    <template v-else>
                      <Button v-if="coverage?.integrity" variant="ghost" size="sm" @click="revealReaderDetails('integrity')"><Info class="size-4" />{{ locale === 'ru' ? 'Проверить целостность' : 'Check integrity' }}</Button>
                      <Button v-if="archiveAdapter.getMessageVersions && versionMessageId" variant="ghost" size="sm" @click="revealReaderDetails('versions')"><GitBranch class="size-4" />{{ locale === 'ru' ? 'Версии сообщения' : 'Message versions' }} · {{ sourceVersions.length }}</Button>
                      <Button v-if="archiveAdapter.getMessageWindow" variant="ghost" size="sm" @click="messageLookupOpen = !messageLookupOpen; toolsOpen = false"><Search class="size-4" />{{ t('reader.jumpMessage') }}</Button>
                    </template>
                  </template>
                </PopoverContent>
              </Popover>
            </div>
            </header>
            <p v-if="rangeStart" class="text-xs text-muted-foreground">{{ locale === 'ru' ? 'Диапазон сохранённых записей' : 'Saved record range' }}: {{ rangeStart.slice(0, 12) }} → {{ rangeEnd?.slice(0, 12) || '…' }}<span v-if="rangeEnd"> · {{ selectedMessages.size }}</span></p>
            <div v-if="archiveAdapter.getMessageWindow && messageLookupOpen" class="booster-reader-message-jump">
              <form @submit.prevent="showServiceRecords = true; lookupMessage()">
                <Input v-model="messageLookup" type="text" maxlength="1024" :aria-label="t('reader.messageId')" :placeholder="t('reader.messageId')"  />
                <Button variant="outline" type="submit" class="booster-action-secondary" :disabled="threadLoading || !messageLookup.trim()">{{ t('reader.openMessage') }}</Button>
              </form>
            </div>
            <div v-if="searchOpen" class="booster-reader-find">
              <Input v-model="textSearch" type="search" :placeholder="t('reader.searchMessages')" :aria-label="t('reader.searchMessages')"  />
              <p v-if="usingIndexedWindows && (hasOlderStored || hasNewerStored || knownStoredCount > thread.recordCount)" class="booster-note">{{ t('reader.windowSearchOnly') }}</p>
            </div>
            <div v-if="coverageLoading" role="status" class="flex items-center gap-2 text-xs text-muted-foreground"><Skeleton class="h-4 w-24" />{{ locale === 'ru' ? 'Проверка начала, конца и разрывов…' : 'Checking first, last and gaps…' }}</div>
            <p v-if="coverageError" role="alert" class="text-xs text-destructive">{{ locale === 'ru' ? 'Целостность не удалось проверить. Экспорт не будет отмечен полным.' : 'Integrity check failed. Export cannot be marked complete.' }}</p>
            <div class="booster-reader-summary">
              <span>{{ t('dock.messages') }}: {{ thread.messageCount }}</span>
              <Button v-if="coverage?.integrity" variant="ghost" size="sm" class="h-7 px-1 text-xs text-muted-foreground" @click="integrityOpen = true"><Info class="size-3" />{{ coverage.completeAtLastRead ? (locale === 'ru' ? 'Архив подтверждён' : 'Archive verified') : (locale === 'ru' ? 'Проверка архива' : 'Archive details') }}</Button>
              <Button v-if="selectedBranchTip" variant="ghost" size="sm" class="h-7 px-1 text-xs" @click="releaseBranchFilter()">{{ locale === 'ru' ? 'Выбрана ветка · показать все' : 'Branch selected · show all' }}</Button>
            </div>
          </template>
        </div>

        <p v-if="staleSavedWindow" role="alert" class="booster-error">
          {{ t('reader.staleWindow') }}
          <Button variant="outline" type="button" class="booster-action-secondary" @click="retryLocation">{{ t('reader.reopenCurrentCopy') }}</Button>
        </p>
        <p v-if="navigationError" role="alert" class="booster-error">{{ t(navigationError) }}</p>
        <p v-if="error" role="alert" class="booster-error">{{ t('reader.error') }}</p>
        <ArchiveReadingSurface class="booster-reader-reading-surface" :class="{ 'booster-reader-timeline-open': historyOpen }" :timeline-visible="Boolean(historyOpen && selected && (timelineNodes.length || navigationNodes.length))">
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
                <p v-if="!filteredTurns.length" class="booster-note">{{ t('reader.noResults') }}</p>
                <article v-for="turn in displayedTurns" :key="turn.id" class="booster-exchange">
                  <p v-if="turn.association === 'unassigned'" class="booster-note">{{ t('reader.unassigned') }}</p>
                  <p v-else-if="turn.association === 'adjacency'" class="booster-note">{{ t('reader.adjacency') }}</p>
                  <ArchiveRecordList :records="turn.messages.filter(i => i.kind === 'user')" :record-key="itemKey" :message-id="itemMessageId" :target-message-id="requestedMessageId"
                    :selectable="selectionEnabled" :selected-ids="selectedMessages" :selection-label="itemSelectionLabel" @select="selectMessage">
                    <template #record="{ record }"><ArchiveRecord :item="record" :locale="locale" :expand-reasoning="reasoningExpanded" :focused="requestedMessageId === record.record.messageId" /></template>
                  </ArchiveRecordList>
                  <Collapsible v-if="turn.details.length" class="booster-exchange-details">
                    <CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="text-xs text-muted-foreground">{{ showServiceRecords ? t('reader.details') : (locale === 'ru' ? 'Действия ассистента' : 'Assistant activity') }} · {{ turn.details.length }}</Button></CollapsibleTrigger><CollapsibleContent>
                    <ArchiveRecordList :records="turn.details" :record-key="itemKey" :message-id="itemMessageId" :target-message-id="requestedMessageId"
                    :selectable="selectionEnabled" :selected-ids="selectedMessages" :selection-label="itemSelectionLabel" @select="selectMessage">
                    <template #record="{ record }"><ArchiveRecord :item="record" :locale="locale" :expand-reasoning="reasoningExpanded" :focused="requestedMessageId === record.record.messageId" /></template>
                  </ArchiveRecordList>
                  </CollapsibleContent></Collapsible>
                  <ArchiveRecordList :records="turn.messages.filter(i => i.kind !== 'user')" :record-key="itemKey" :message-id="itemMessageId" :target-message-id="requestedMessageId"
                    :selectable="selectionEnabled" :selected-ids="selectedMessages" :selection-label="itemSelectionLabel" @select="selectMessage">
                    <template #record="{ record }"><ArchiveRecord :item="record" :locale="locale" :expand-reasoning="reasoningExpanded" :focused="requestedMessageId === record.record.messageId" /></template>
                  </ArchiveRecordList>
                </article>
              </div>
            </template>
            <p v-else-if="!listLoading" class="booster-note">{{ t('reader.missing') }}</p>
          </div>
        </ArchiveReadingSurface>
      </main>
    </div>

    <Dialog v-model:open="navigationOpen"><DialogContent @close-auto-focus="restoreToolsFocus" class="w-[calc(100vw-24px)] max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{{ locale === 'ru' ? 'Ветки и переходы' : 'Branches and navigation' }}</DialogTitle><DialogDescription>{{ locale === 'ru' ? 'Переходите по сохранённой переписке или выберите другую ветку.' : 'Navigate saved messages or choose another branch.' }}</DialogDescription></DialogHeader>
      <div class="flex flex-wrap gap-2" role="toolbar" :aria-label="locale === 'ru' ? 'Навигация по сохранённому архиву' : 'Saved archive navigation'">
        <Button variant="outline" size="sm" :disabled="threadLoading || loadingOlder" @click="returnToFirstKnown(); navigationOpen = false">{{ locale === 'ru' ? 'К началу' : 'First' }}</Button>
        <Button v-if="archiveAdapter.getPositionWindow" variant="outline" size="sm" :disabled="threadLoading || loadingOlder" @click="returnToMiddle(); navigationOpen = false">{{ locale === 'ru' ? 'К середине' : 'Middle' }}</Button>
        <Button variant="outline" size="sm" :disabled="threadLoading || loadingOlder" @click="returnToLatest(); navigationOpen = false">{{ locale === 'ru' ? 'К концу' : 'Latest' }}</Button>
      </div>
            <div v-if="coverage?.integrity && archiveAdapter.getBranchPath && storedBranches.length" class="booster-reader-branch-navigation">
              <Label class="booster-reader-path-select">{{ locale === 'ru' ? 'Ветка диалога' : 'Conversation branch' }}
                <Select :model-value="selectedBranchTip ?? '__all__'" :disabled="branchLoading || threadLoading" @update:model-value="chooseBranch(String($event) === '__all__' ? '' : String($event)); navigationOpen = false"><SelectTrigger class="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="__all__">{{ locale === 'ru' ? 'Весь диалог' : 'Entire conversation' }}</SelectItem>
                  <SelectItem v-for="(tipId, index) in coverage.integrity.tips" :key="tipId" :value="tipId">{{ storedBranches.length ? (locale === 'ru' ? 'Ветка' : 'Branch') : coverage.integrity.chain === 'gaps' ? (locale === 'ru' ? 'Фрагмент' : 'Fragment') : (locale === 'ru' ? 'Путь' : 'Path') }} {{ index + 1 }} {{ locale === 'ru' ? 'из' : 'of' }} {{ coverage.integrity.tips.length }} · {{ branchPreview(tipId) }}</SelectItem>
                </SelectContent></Select>
              </Label>
              <span v-if="!storedBranches.length && coverage.integrity.chain === 'gaps'" class="booster-note">{{ locale === 'ru' ? 'Связи неполны: фрагменты не означают ветвление диалога.' : 'Incomplete links: fragments do not imply conversation branches.' }}</span>
            </div>
      <p v-if="!storedBranches.length" class="text-sm text-muted-foreground">{{ locale === 'ru' ? 'В этом диалоге нет сохранённых веток.' : 'This conversation has no saved branches.' }}</p>
    </DialogContent></Dialog>
    <Dialog v-model:open="integrityOpen"><DialogContent @close-auto-focus="restoreToolsFocus" v-if="coverage?.integrity" class="w-[calc(100vw-24px)] max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{{ locale === 'ru' ? 'Проверка архива' : 'Archive details' }}</DialogTitle><DialogDescription>{{ locale === 'ru' ? 'Полнота сохранения, границы и связи сообщений.' : 'Saved coverage, boundaries and message relationships.' }}</DialogDescription></DialogHeader>
            <div class="booster-reader-summary">
              <span>{{ t('dock.messages') }}: <b>{{ thread.messageCount }}</b> · {{ t('dock.details') }}: {{ thread.detailCount }}<template v-if="usingIndexedWindows"> · {{ locale === 'ru' ? 'Загружено' : 'Loaded' }} {{ thread.recordCount }}/{{ knownStoredCount }}</template></span>
              <span v-if="usingIndexedWindows && hasUnsequencedRecords" class="booster-reader-coverage">{{ locale === 'ru' ? 'Есть сообщения без подтверждённого времени' : 'Some messages have no confirmed chronology' }}</span>
              <span v-if="coverage?.integrity" class="booster-reader-coverage">{{ locale === 'ru' ? 'Начало' : 'Start' }}: {{ evidenceLabel(coverage.integrity.start) }} · {{ locale === 'ru' ? 'Конец' : 'End' }}: {{ evidenceLabel(coverage.integrity.end) }}</span>
              <span class="booster-reader-coverage" :title="t(archiveStatusKey)" :aria-label="t(archiveStatusKey)"><Info class="size-4" />{{ coverage?.completeAtLastRead ? (locale === 'ru' ? 'Цепочка подтверждена' : 'Path verified') : (locale === 'ru' ? 'Цепочка не подтверждена' : 'Path unverified') }}</span>
              <span v-if="selectedBranchIds">{{ locale === 'ru' ? 'В выбранном пути' : 'Selected path' }}: {{ selectedBranchIds.size }}</span>
            </div>
              <p v-if="readSource === 'saved'" class="booster-note">{{ t('reader.savedInspection') }}</p>
              <p v-if="unsequencedTarget" class="booster-note">{{ t('reader.targetUnsequenced') }}</p>
              <p class="booster-note">{{ locale === 'ru' ? 'Неизвестная связь отличается от подтверждённого разрыва. Проверка охватывает все сохранённые сообщения. Содержимое загружается постепенно, таймлайн использует лёгкие метаданные.' : 'Unknown ancestry differs from a confirmed gap. Integrity covers all saved messages. Content loads progressively; the timeline uses lightweight metadata.' }}</p>
              <div class="flex flex-wrap gap-2">
                <Button v-if="coverage.integrity.firstMessageId" variant="outline" size="sm" @click="inspectMessage(coverage.integrity.firstMessageId)">{{ locale === 'ru' ? 'Первое сообщение' : 'First message' }} · {{ coverage.integrity.firstMessageId.slice(0, 12) }}</Button>
                <Button v-if="coverage.integrity.lastMessageId" variant="outline" size="sm" @click="inspectMessage(coverage.integrity.lastMessageId)">{{ locale === 'ru' ? 'Последнее сообщение' : 'Last message' }} · {{ coverage.integrity.lastMessageId.slice(0, 12) }}</Button>
              </div>
              <div v-for="issue in coverage.integrity.issues" :key="issue.reason + issue.messageId" data-integrity-issue>
                <Button variant="outline" type="button" class="h-auto whitespace-normal" @click="inspectMessage(issue.reason === 'missing-head' ? (coverage.integrity?.tips.at(-1) ?? issue.messageId) : issue.messageId)">{{ evidenceLabel(issue.reason) }} · {{ issue.reason === 'missing-head' ? (locale === 'ru' ? 'Открыть последнее сохранённое' : 'Open last saved message') : issue.messageId.slice(0, 12) }}</Button>
                <small v-if="issue.parentId">{{ locale === 'ru' ? 'Не найден родитель' : 'Missing parent' }}: {{ issue.parentId }}</small>
              </div>
    </DialogContent></Dialog>
            <Dialog v-model:open="versionsOpen"><DialogContent @close-auto-focus="restoreToolsFocus" v-if="versionMessageId" class="w-[calc(100vw-24px)] max-w-2xl max-h-[85dvh] overflow-y-auto" :data-version-message="versionMessageId"><DialogHeader><DialogTitle>{{ locale === 'ru' ? 'Версии сообщения' : 'Message versions' }}</DialogTitle><DialogDescription>{{ locale === 'ru' ? 'Сохранённые варианты исходной записи.' : 'Saved variants of the original record.' }}</DialogDescription></DialogHeader>
              <Label>{{ locale === 'ru' ? 'Сохранённая версия сообщения' : 'Saved message version' }}
                <Select :model-value="String(selectedVersion)" @update:model-value="selectedVersion = Number($event)"><SelectTrigger class="w-full"><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem v-for="(version, index) in sourceVersions" :key="index" :value="String(index)">{{ index + 1 }} · {{ new Date(version.observedAtMs).toLocaleString(locale) }} · {{ evidenceLabel(version.decision) }}</SelectItem>
                </SelectContent></Select></Label>
              <p class="booster-note">{{ locale === 'ru' ? 'Переключение меняет только локальный просмотр. Исходные варианты и данные ChatGPT сохраняются.' : 'Selection changes local inspection only. All source variants and native ChatGPT data remain preserved.' }}</p>
              <p v-if="versionError" role="alert" class="booster-error">{{ locale === 'ru' ? 'Не удалось открыть версии' : 'Could not open versions' }}</p>
              <Skeleton v-if="versionsLoading" class="h-20 w-full" />
              <ArchiveRecord v-for="item in versionItems" :key="item.record.messageKey + ':' + selectedVersion" :item="item" :locale="locale" :expand-reasoning="true" :focused="true" />
            </DialogContent></Dialog>

  </div>
</template>
