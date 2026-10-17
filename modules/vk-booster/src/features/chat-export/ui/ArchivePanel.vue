<script setup lang="ts">
import { useApplicationLocale, useLocalizedText } from '@kobaproduction/browser-ui'
import { VK_UI_MESSAGES } from './ui-messages'
/** VK tool adapter. Shared archive widgets own record and selection presentation. */

import type { ChatCollectionSnapshot } from '@kobaproduction/browser-archive'
import {
  ARCHIVE_READER_PAGE_SIZE,
  type ArchiveReadingDirection,
  archiveExportSelectionIds,
  createChatCollectionController,
  defaultArchiveExportSelection,
  mergeArchiveReaderRecords,
} from '@kobaproduction/browser-archive'
import { SHELL_RESTORE_UI_EVENT } from '@kobaproduction/browser-core'
import {
  Button,
  Card,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  ModalSurface,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@kobaproduction/browser-ui'
import {
  ArchiveExportFormatFields,
  ArchiveExportScopeFields,
  ArchiveMessageHeader,
  ArchiveProgressBar,
  ArchiveReaderNavigation,
  ArchiveReadingSurface,
  ArchiveRecordList,
  ArchiveTimeline,
  ConversationCollectionAction,
  createArchiveReadingScroll,
  useApplicationTelemetry,
  useArchiveFocusTracker,
} from '@kobaproduction/browser-widgets'
import {
  Archive,
  ChevronDown,
  Download,
  History,
  LoaderCircle,
  Settings2,
  ShieldAlert,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { assets } from '../api/vk-assets'
import { vkArchiveErrorMessage } from '../model/archive-error-feedback'
import { vkChatCollectionPort } from '../model/chat-collection-port'
import { vkPreferencesLoadError, vkPreferencesPersistence } from '../model/durable-preferences'
import {
  defaultVkCapturePreferences,
  type VkCapturePreferences,
  validateVkCapturePreferences,
} from '../model/settings-backup'
import type { VkAsset } from '../model/types'
import {
  type ArchiveStatus,
  archiveApi,
  type VkArchiveCoverage,
  type VkMessage,
  type VkTimelineEntry,
} from '../model/types'
import { vkActiveView, vkRequestedView } from '../model/ui-navigation'
import type { VkExportProgress, VkUserExportResult } from '../model/vk-user-export'

const locale = useApplicationLocale()
const text = useLocalizedText(VK_UI_MESSAGES)

const api = archiveApi()
defineProps<{ installation?: string; version?: string; showCatalog?: boolean; showIdentity?: boolean }>()
const telemetry = useApplicationTelemetry('vk-booster')
const timelineId = useId()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
type View = 'capture' | 'reader' | 'settings'
const tab = ref<View>(status.value?.activePeerId ? vkActiveView.value : 'settings')
watch(
  tab,
  (value, previous) => {
    if (previous === 'reader' && value !== 'reader') leaveReader()
    vkActiveView.value = value
  },
  { immediate: true },
)
watch(vkActiveView, (value) => {
  if (tab.value !== value) enterTab(value)
})
const fixedBusy = ref(false)
const activeOperation = ref<'capture' | 'export' | null>(null)
const captureRange = ref<'all' | 'recent'>('all')
const savedCapturePreferences = ref<VkCapturePreferences>(defaultVkCapturePreferences())
const fixedLimit = ref(
  Math.min(100000, Math.max(1, status.value?.options.limit ?? savedCapturePreferences.value.limit)),
)
const requestPageSize = ref(status.value?.options.pageSize ?? 50)
const requestDelay = ref(status.value?.options.delay ?? 450)
function applyCapturePreferences(saved: VkCapturePreferences) {
  savedCapturePreferences.value = saved
  fixedLimit.value = saved.limit
  requestPageSize.value = saved.pageSize
  requestDelay.value = saved.delay
}
async function refreshCapturePreferences() {
  try {
    const options = api?.status().options
    const saved = options
      ? validateVkCapturePreferences({
          mode: options.mode,
          limit: options.limit,
          from: options.from,
          through: options.through,
          pageSize: options.pageSize,
          delay: options.delay,
          media: options.media,
        })
      : await vkPreferencesPersistence()?.read()
    if (!disposed && saved) applyCapturePreferences(saved)
  } catch {
    if (!disposed) durableSettingsError.value = 'Не удалось загрузить постоянные параметры VK.'
  }
}
function onRestorePreferences() {
  if (!fixedBusy.value) void refreshCapturePreferences()
}
const captureComplete = ref<boolean | null>(null)
const reportedTotal = ref<number | null>(null)
const attachmentReferences = ref<number | null>(null)
const collector = api
  ? createChatCollectionController(
      vkChatCollectionPort(api, () => (captureRange.value === 'all' ? 'all' : fixedLimit.value)),
    )
  : null
const collectionState = ref<ChatCollectionSnapshot>(
  collector?.snapshot() ?? {
    phase: 'idle',
    processed: 0,
    total: null,
    saved: null,
  },
)
const unsubscribeCollection = collector?.subscribe((next) => {
  collectionState.value = next
})
onUnmounted(() => {
  unsubscribeCollection?.()
  collector?.dispose()
})
const fixedSaved = ref<number | null>(null)
const fixedError = ref('')
const fixedPreview = ref<readonly VkMessage[]>([])
const fixedCursor = ref<number | undefined>()
const fixedReading = ref(false)
const readerViewport = ref<HTMLElement | null>(null)
let readerGeneration = 0
let scopeGeneration = 0
let disposed = false
const readerFocus = useArchiveFocusTracker(
  () => readerViewport.value,
  () => !disposed && tab.value === 'reader' && !fixedReading.value,
)
let readerRevision = -1
let readerOwnerId: string | null = null
let readerWork: Promise<void> = Promise.resolve()
let latestTimelineTarget: string | null = null
let timelineNavigating = false
let savedRefreshTimer: ReturnType<typeof setTimeout> | undefined
let savedRevision = 0
function scheduleSavedRefresh() {
  if (savedRefreshTimer !== undefined) clearTimeout(savedRefreshTimer)
  savedRefreshTimer = setTimeout(() => {
    savedRefreshTimer = undefined
    if (tab.value !== 'reader' || !hasVerifiedPeer.value) return
    if (fixedReading.value || fixedBusy.value || api?.status().busy) {
      scheduleSavedRefresh()
      return
    }
    void readDexie(fixedCursor.value, Math.max(ARCHIVE_READER_PAGE_SIZE, fixedPreview.value.length))
  }, 350)
}
const participantNames = ref<Record<number, string>>({})
const nameLookupError = ref('')
const attachments = ref<Record<string, { blob: Blob; url: string; name: string }>>({})
const downloading = ref<Record<string, boolean>>({})
const attachmentErrors = ref<Record<string, string>>({})
const mediaRequests = new Set<AbortController>()
function stopMediaRequests() {
  for (const request of mediaRequests) request.abort()
  mediaRequests.clear()
}
const exportOpen = ref(false)
const exportChunkRows = ref<100 | 500>(500)
const exportFormat = ref<'json' | 'markdown' | 'text'>('markdown')
const exportFormats = [
  { id: 'json', label: 'JSON' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'text', label: 'TXT' },
]
const exportPackages = [
  { id: 'none', label: 'Один файл' },
  { id: 'zip', label: 'ZIP' },
]
const exportIncludeReferences = ref(true)
const exportPackaging = ref<'zip' | 'none'>('none')
const exportIncludeMedia = ref(false)
const exportIncludeOriginal = ref(false)
const exportSelection = ref(defaultArchiveExportSelection())
const exportAdvanced = ref(false)
const selectionEnabled = ref(false)
const selectedMessageIds = ref<ReadonlySet<number>>(new Set())
const selectedRecordIds = computed(() => new Set([...selectedMessageIds.value].map(String)))
const exportPrepared = ref<VkUserExportResult | null>(null)
const exportProgress = ref<VkExportProgress | null>(null)
const speedOpen = ref(false)
const coverage = ref<VkArchiveCoverage | null>(null)
const timelineEntries = ref<readonly VkTimelineEntry[]>([])
const exportMessages = computed(() =>
  timelineEntries.value.map((entry) => ({
    id: String(entry.id),
    timestampMs: entry.date === null ? null : entry.date * 1000,
    author:
      (entry.senderId && participantNames.value[entry.senderId]) ||
      (entry.outgoing ? text('Вы') : text('Неизвестный отправитель')),
    text: entry.text ?? '',
  })),
)
const exportSelectedIds = computed({
  get: () => [...selectedMessageIds.value].map(String),
  set: (ids: readonly string[]) => {
    selectedMessageIds.value = new Set(
      ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    )
    resetPreparedExport()
  },
})
const exportMessageIds = computed(() => {
  try {
    return archiveExportSelectionIds(
      exportMessages.value,
      exportSelection.value,
      exportSelectedIds.value,
    )
  } catch {
    return []
  }
})
const exportScopeEmpty = computed(
  () => exportMessageIds.value !== undefined && !exportMessageIds.value.length,
)
const exportScopeStale = computed(
  () =>
    exportSelection.value.mode !== 'all' && (timelineBusy.value || timelineRevision !== savedRevision),
)
const readerEdges = computed(() => {
  const first = timelineEntries.value.findIndex((entry) => entry.id === fixedPreview.value[0]?.id)
  const last = timelineEntries.value.findIndex((entry) => entry.id === fixedPreview.value.at(-1)?.id)
  return { first, older: first > 0, newer: last >= 0 && last < timelineEntries.value.length - 1 }
})
const readerScroll = createArchiveReadingScroll({
  viewport: () => readerViewport.value,
  enabled: () =>
    !disposed &&
    tab.value === 'reader' &&
    !fixedReading.value &&
    !fixedBusy.value &&
    !timelineNavigating &&
    readerRevision === savedRevision,
  canLoad: (direction) => readerEdges.value[direction],
  load: async (direction) => {
    if (direction === 'newer') {
      const last = fixedPreview.value.at(-1)?.id
      if (last !== undefined) await readDexie(last, ARCHIVE_READER_PAGE_SIZE, direction)
    } else {
      const end = readerEdges.value.first
      if (end <= 0) return
      const start = Math.max(0, end - ARCHIVE_READER_PAGE_SIZE)
      await readDexie(timelineEntries.value[start - 1]?.id, end - start, direction)
    }
  },
})
function onReadingScroll() {
  readerFocus.schedule()
  void readerScroll.onScroll()
}
const activeMessageId = ref<string | null>(null)
watch(readerFocus.activeMessageKey, (key) => {
  if (key?.startsWith('vk:')) activeMessageId.value = key.slice(3)
})
const timelineBusy = ref(false)
const timelineOpen = ref(true)
const coverageOpen = ref(false)
let timelineRevision = -1
let timelineGeneration = 0
let timelineRequest: AbortController | undefined, rangeRequest: AbortController | undefined
function cancelReaderTasks() {
  readerScroll.reset()
  timelineRequest?.abort()
  rangeRequest?.abort()
  latestTimelineTarget = null
}
function leaveReader() {
  cancelReaderTasks()
  stopMediaRequests()
  readerGeneration++
  fixedReading.value = false
}
const timelineNodes = computed(() =>
  timelineEntries.value.map((entry, index, entries) => {
    const previous = entries[index - 1]
    if (index > 0 && !previous) throw Error('Timeline entries must be dense')
    return {
      id: String(entry.id),
      parentId: previous ? String(previous.id) : null,
      label:
        (entry.senderId && participantNames.value[entry.senderId]) ||
        (entry.outgoing ? text('Вы') : text('Неизвестный отправитель')),
      timestampMs: entry.date === null ? null : entry.date * 1000,
      preview: entry.text ?? '',
      uncertain: coverage.value?.integrity.chain !== 'verified',
    }
  }),
)
const timelineVisible = computed(() => timelineOpen.value && timelineNodes.value.length > 0)
const rangeStart = ref<VkMessage | null>(null),
  rangeEnd = ref<VkMessage | null>(null),
  rangeBusy = ref(false)
async function refreshTimeline(peer: number | null | undefined, ticket: number) {
  if (!api || timelineBusy.value || timelineRevision === savedRevision) return
  timelineBusy.value = true
  const generation = ++timelineGeneration
  const request = new AbortController()
  timelineRequest = request
  const revision = savedRevision
  try {
    const [entries, summary] = await Promise.all([
      api.timelineFixed?.(request.signal),
      api.coverageFixed?.(),
    ])
    if (
      disposed ||
      generation !== timelineGeneration ||
      request.signal.aborted ||
      scopeGeneration !== ticket ||
      api.status().activePeerId !== peer
    )
      return
    if (entries) timelineEntries.value = entries
    coverage.value = summary ?? null
    timelineRevision = revision
  } catch {
    if (!request.signal.aborted && !disposed && scopeGeneration === ticket)
      fixedError.value =
        'Не удалось проверить таймлайн и полноту. Сохранённые сообщения остаются доступны.'
  } finally {
    if (generation === timelineGeneration) timelineBusy.value = false
  }
}
async function navigateTimeline(id: string) {
  const messageId = Number(id)
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return
  latestTimelineTarget = id
  if (timelineNavigating) return
  timelineNavigating = true
  const scope = scopeGeneration
  try {
    while (latestTimelineTarget && !disposed && tab.value === 'reader' && scope === scopeGeneration) {
      const target = latestTimelineTarget
      latestTimelineTarget = null
      const targetId = Number(target)
      if (!fixedPreview.value.some((message) => message.id === targetId)) {
        const index = timelineEntries.value.findIndex((entry) => entry.id === targetId)
        const start = Math.max(
          0,
          Math.min(
            index - ARCHIVE_READER_PAGE_SIZE / 2,
            timelineEntries.value.length - ARCHIVE_READER_PAGE_SIZE,
          ),
        )
        await readDexie(index < 0 ? targetId - 1 : timelineEntries.value[start - 1]?.id)
      }
      if (
        !disposed &&
        tab.value === 'reader' &&
        scope === scopeGeneration &&
        !latestTimelineTarget &&
        fixedPreview.value.some((message) => message.id === targetId)
      ) {
        activeMessageId.value = target
        readerFocus.pin(`vk:${target}`)
        await nextTick()
        if (disposed || tab.value !== 'reader' || scope !== scopeGeneration || latestTimelineTarget)
          continue
        const viewport = readerViewport.value
        const node = [...(viewport?.querySelectorAll<HTMLElement>('[data-archive-message]') ?? [])].find(
          (element) => element.dataset.archiveMessage === target,
        )
        if (viewport && node) {
          const bounds = viewport.getBoundingClientRect(),
            targetBounds = node.getBoundingClientRect()
          viewport.scrollTop +=
            targetBounds.top - bounds.top - Math.max(0, (bounds.height - targetBounds.height) / 2)
        }
      }
    }
  } finally {
    timelineNavigating = false
    const pending = latestTimelineTarget
    if (pending && !disposed && tab.value === 'reader') void navigateTimeline(pending)
  }
}
async function markRange(edge: 'first' | 'last') {
  if (!activeMessageId.value || !api?.rangeFixed || rangeBusy.value) return
  const current = fixedPreview.value.find((message) => String(message.id) === activeMessageId.value)
  if (!current) return
  if (edge === 'first') rangeStart.value = current
  else rangeEnd.value = current
  selectedMessageIds.value = new Set()
  resetPreparedExport()
  if (!rangeStart.value || !rangeEnd.value) return
  const ticket = scopeGeneration,
    peer = api.status().activePeerId
  rangeBusy.value = true
  const request = new AbortController()
  rangeRequest = request
  try {
    const range = await api.rangeFixed(rangeStart.value.id, rangeEnd.value.id, request.signal)
    if (request.signal.aborted || ticket !== scopeGeneration || api.status().activePeerId !== peer)
      return
    selectedMessageIds.value = new Set(range.messageIds)
    rangeStart.value = range.first
    rangeEnd.value = range.last
  } catch {
    if (!request.signal.aborted && ticket === scopeGeneration)
      fixedError.value = 'Диапазон изменился или недоступен. Выбери границы повторно.'
  } finally {
    rangeBusy.value = false
  }
}
function chooseTab(value: string | number) {
  if (value === 'capture' || value === 'reader' || value === 'settings') enterTab(value)
}
function chooseChunkRows(value: unknown) {
  if (value === '100' || value === '500') {
    exportChunkRows.value = Number(value) as 100 | 500
    resetPreparedExport()
  }
}
function senderName(message: VkMessage): string {
  const id = message.from_id
  if (typeof id === 'number') {
    const name = participantNames.value[id]
    if (name) return name
  }
  if (message.out === 1 || message.out === true) return text('Вы')
  return id && Number.isSafeInteger(id)
    ? `${text('Участник')} ${id} (${text('имя не получено')})`
    : text('Неизвестный отправитель')
}
function messageMedia(message: VkMessage): VkAsset[] {
  return assets(message).filter((item) => item.type !== 'link')
}
async function requestMedia(messageId: number, asset: VkAsset) {
  if (
    !api?.downloadAttachmentFixed ||
    downloading.value[asset.key] ||
    attachments.value[asset.key] ||
    !hasVerifiedPeer.value
  )
    return
  downloading.value = { ...downloading.value, [asset.key]: true }
  const peer = api?.status().activePeerId
  const scopeTicket = scopeGeneration
  const request = new AbortController()
  const timeout = setTimeout(() => request.abort(), 30000)
  mediaRequests.add(request)
  attachmentErrors.value = { ...attachmentErrors.value, [asset.key]: '' }
  try {
    const result = await api.downloadAttachmentFixed(messageId, asset.key, request.signal)
    if (disposed || scopeTicket !== scopeGeneration || !peer || api?.status().activePeerId !== peer)
      throw Error('Переписка изменилась.')
    const blob = result.blob
    attachments.value = {
      ...attachments.value,
      [asset.key]: {
        blob,
        url: URL.createObjectURL(blob),
        name: result.name,
      },
    }
  } catch (error) {
    if (disposed || request.signal.aborted || scopeTicket !== scopeGeneration) return
    attachmentErrors.value = {
      ...attachmentErrors.value,
      [asset.key]:
        error instanceof Error && error.message === 'VK attachment unavailable or unsafe'
          ? 'Не удалось загрузить оригинал. Ссылка может быть недоступна или истекла.'
          : vkArchiveErrorMessage(error),
    }
  } finally {
    clearTimeout(timeout)
    mediaRequests.delete(request)
    if (!disposed && scopeTicket === scopeGeneration)
      downloading.value = { ...downloading.value, [asset.key]: false }
  }
}
function resetPreparedExport() {
  exportPrepared.value = null
  exportProgress.value = null
}
function showUserExportOptions() {
  exportOpen.value = true
  resetPreparedExport()
}
function selectMessage(id: string, checked: boolean) {
  if (fixedBusy.value || rangeBusy.value) return
  const messageId = Number(id)
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return
  const next = new Set(selectedMessageIds.value)
  if (checked) next.add(messageId)
  else next.delete(messageId)
  selectedMessageIds.value = next
  rangeStart.value = null
  rangeEnd.value = null
  resetPreparedExport()
}
function selectPage() {
  if (fixedBusy.value || rangeBusy.value) return
  selectedMessageIds.value = new Set([
    ...selectedMessageIds.value,
    ...fixedPreview.value.map((message) => message.id),
  ])
  rangeStart.value = null
  rangeEnd.value = null
  resetPreparedExport()
}
function clearSelection() {
  selectedMessageIds.value = new Set()
  rangeStart.value = null
  rangeEnd.value = null
  resetPreparedExport()
}
watch(exportSelection, resetPreparedExport, { deep: true })
watch(exportFormat, resetPreparedExport)
watch([exportPackaging, exportIncludeMedia, exportIncludeOriginal], resetPreparedExport)
const messageKey = (message: VkMessage) => `vk:${message.id}`
const messageId = (message: VkMessage) => message.id
function selectionLabel(message: VkMessage) {
  return `${text('Выбрать сообщение:')} ${senderName(message)}`
}

const hasVerifiedPeer = computed(() => !!status.value?.activePeerId && !status.value?.blockedReason)
async function persistCaptureOptions() {
  // ArchiveOptions includes peerId, which must never enter the persisted
  // seven-field preferences envelope (strictly validated below).
  const { mode, from, through, media } = api?.status().options ?? savedCapturePreferences.value
  const options = validateVkCapturePreferences({
    mode,
    limit: fixedLimit.value,
    from,
    through,
    pageSize: requestPageSize.value,
    delay: requestDelay.value,
    media,
  })
  api?.configure(options)
  const port = vkPreferencesPersistence()
  try {
    if (!port) throw Error('VK settings storage unavailable')
    await port.write(options)
    savedCapturePreferences.value = options
    durableSettingsError.value = ''
  } catch {
    durableSettingsError.value = 'Не удалось сохранить параметры для следующего запуска.'
  }
}
async function saveCaptureOptions() {
  if (fixedBusy.value) return
  try {
    await persistCaptureOptions()
  } catch {
    fixedError.value = 'Проверь количество сообщений, размер пачки и задержку.'
  }
}
async function captureDexie() {
  if (!api || fixedBusy.value || !hasVerifiedPeer.value) return
  const peer = api.status().activePeerId
  const scopeTicket = scopeGeneration
  fixedBusy.value = true
  resetPreparedExport()
  void telemetry?.record('archive.capture.started')
  activeOperation.value = 'capture'
  fixedError.value = ''
  try {
    await persistCaptureOptions()
    if (!collector) throw Error('VK collector unavailable')
    await collector.start()
    if (scopeTicket !== scopeGeneration || api.status().activePeerId !== peer) return
    const latest = api.status()
    fixedSaved.value = latest.progress.newCount ?? null
    void telemetry?.record('archive.capture.completed', latest.progress.newCount ?? 0)
    reportedTotal.value = latest.progress.total || null
    captureComplete.value = latest.progress.phase === 'Dexie: сохранено'
    attachmentReferences.value = latest.progress.attachmentReferences ?? null
  } catch (error) {
    if (scopeTicket !== scopeGeneration || api.status().activePeerId !== peer) return
    void telemetry?.record('archive.capture.failed')
    captureComplete.value = false
    fixedError.value = `${text('Сбор прерван.')} ${text(vkArchiveErrorMessage(error))}`
  } finally {
    activeOperation.value = null
    fixedBusy.value = false
  }
}
function readDexie(
  cursor?: number,
  limit = ARCHIVE_READER_PAGE_SIZE,
  direction?: ArchiveReadingDirection,
): Promise<void> {
  const scope = scopeGeneration
  const work = readerWork.then(async () => {
    if (disposed || tab.value !== 'reader' || scope !== scopeGeneration) return
    await readDexiePage(cursor, limit, direction)
  })
  readerWork = work.catch(() => undefined)
  return work
}
async function readDexiePage(
  cursor?: number,
  limit = ARCHIVE_READER_PAGE_SIZE,
  direction?: ArchiveReadingDirection,
) {
  if (!api || tab.value !== 'reader' || fixedBusy.value || fixedReading.value || !hasVerifiedPeer.value)
    return
  fixedReading.value = true
  fixedError.value = ''
  const ticket = ++readerGeneration
  const peer = api.status().activePeerId
  const revision = savedRevision
  try {
    const window = await api.readWindowFixed?.(
      limit,
      cursor,
      readerOwnerId
        ? {
            ownerId: readerOwnerId,
            ...(direction ? { revision: readerRevision } : {}),
          }
        : undefined,
    )
    const incoming = window?.messages ?? (await api.readFixed(limit, cursor))
    if (ticket !== readerGeneration || api.status().activePeerId !== peer) return
    if (revision !== savedRevision || (window && window.revision !== revision)) {
      scheduleSavedRefresh()
      return
    }
    if (window) readerOwnerId = window.ownerId
    const viewport = readerViewport.value
    const preserveScroll = direction !== undefined || cursor === fixedCursor.value
    const scrollTop = viewport?.scrollTop ?? 0
    const anchor = preserveScroll ? readerScroll.capture() : null
    const rows = direction
      ? mergeArchiveReaderRecords(fixedPreview.value, incoming, direction, {
          key: (message) => message.id,
          compare: (left, right) => left.id - right.id,
        }).records
      : incoming
    fixedPreview.value = rows
    fixedCursor.value = rows[0] ? rows[0].id - 1 : cursor
    if (!activeMessageId.value || !rows.some((message) => String(message.id) === activeMessageId.value))
      activeMessageId.value = rows[0] ? String(rows[0].id) : null
    void refreshTimeline(peer, scopeGeneration)
    readerRevision = revision
    await nextTick()
    if (ticket !== readerGeneration || api.status().activePeerId !== peer) return
    if (viewport && viewport === readerViewport.value) {
      viewport.scrollTop = preserveScroll ? scrollTop : 0
      if (preserveScroll) readerScroll.restore(anchor)
    }
    fixedReading.value = false
    readerFocus.schedule()
    // Names are fetched separately. An unavailable VK users.get cannot
    // delay the saved transcript or erase records from the Reader.
    const ids = [
      ...new Set(
        rows
          .map((row) => row.from_id)
          .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0),
      ),
    ]
    void api
      .resolveParticipants(ids)
      .then((people) => {
        if (ticket !== readerGeneration || api.status().activePeerId !== peer) return
        participantNames.value = {
          ...participantNames.value,
          ...Object.fromEntries(people.map((person) => [person.id, person.name])),
        }
        nameLookupError.value =
          ids.length > people.length
            ? 'Часть имён VK не предоставил. Идентификаторы показаны без подмены.'
            : ''
      })
      .catch(() => {
        if (ticket === readerGeneration && api.status().activePeerId === peer)
          nameLookupError.value = 'VK не предоставил имена участников. Сообщения сохранены и доступны.'
      })
  } catch (error) {
    if (ticket === readerGeneration) {
      if (error instanceof Error && error.message === 'VK archive reader owner changed') {
        resetReaderScope()
        scheduleSavedRefresh()
      }
      fixedError.value = `${text('Чтение:')} ${text(vkArchiveErrorMessage(error))}`
    }
  } finally {
    if (ticket === readerGeneration) fixedReading.value = false
  }
}
async function prepareUserExport() {
  if (!api || fixedBusy.value || rangeBusy.value || !hasVerifiedPeer.value || !exportOpen.value) return
  if (exportScopeEmpty.value || exportScopeStale.value) return
  const peer = api.status().activePeerId
  const scopeTicket = scopeGeneration
  fixedBusy.value = true
  activeOperation.value = 'export'
  fixedError.value = ''
  resetPreparedExport()
  try {
    const loaded = Object.entries(attachments.value).map(([key, value]) => ({
      key,
      name: value.name,
      blob: value.blob,
    }))
    const result = await api.exportUserConversation(
      {
        chunkRows: exportChunkRows.value,
        includeReferences: exportIncludeReferences.value,
        format: exportFormat.value,
        packaging: exportPackaging.value,
        includeMedia: exportPackaging.value === 'zip' && exportIncludeMedia.value,
        includeOriginal: exportIncludeOriginal.value,
        messageIds: exportMessageIds.value?.map(Number),
        expectedRevision: exportSelection.value.mode === 'all' ? undefined : timelineRevision,
        downloadedMedia: loaded,
      },
      (progress) => {
        if (scopeTicket === scopeGeneration && api.status().activePeerId === peer)
          exportProgress.value = progress
      },
    )
    if (scopeTicket !== scopeGeneration || api.status().activePeerId !== peer) return
    if (!result.blob.size) throw Error('Export returned an empty file')
    exportPrepared.value = result
    void telemetry?.record('archive.export.completed')
  } catch (error) {
    if (scopeTicket === scopeGeneration && api.status().activePeerId === peer) {
      void telemetry?.record('archive.export.failed')
      fixedError.value = `${text('Экспорт:')} ${text(vkArchiveErrorMessage(error))}`
    }
  } finally {
    activeOperation.value = null
    fixedBusy.value = false
  }
}
function downloadPreparedExport() {
  const result = exportPrepared.value
  if (!result || fixedBusy.value || !hasVerifiedPeer.value) return
  const url = URL.createObjectURL(result.blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `vk-saved-conversation.${result.extension}`
    document.body.append(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
function enterTab(view: View) {
  if (view !== 'settings' && !hasVerifiedPeer.value) {
    tab.value = 'settings'
    return
  }
  tab.value = view
  if (view === 'reader') {
    const initial = !fixedPreview.value.length
    void refreshTimeline(api?.status().activePeerId, scopeGeneration).then(() => {
      if (initial && tab.value === 'reader' && timelineEntries.value.length)
        void navigateTimeline(String(timelineEntries.value.at(-1)?.id))
      else if (!fixedReading.value && (!fixedPreview.value.length || readerRevision !== savedRevision))
        void readDexie(fixedCursor.value, Math.max(ARCHIVE_READER_PAGE_SIZE, fixedPreview.value.length))
    })
  }
}
const tabs: { id: View; label: string; icon: typeof Archive }[] = [
  { id: 'capture', label: 'Выгрузка', icon: Download },
  { id: 'reader', label: 'Архив', icon: Archive },
  { id: 'settings', label: 'Параметры', icon: Settings2 },
]
const visibleTabs = computed(() =>
  tabs.filter((item) => item.id === 'settings' || hasVerifiedPeer.value),
)
watch(
  hasVerifiedPeer,
  (available) => {
    if (!available) tab.value = 'settings'
  },
  { immediate: true },
)
const durableSettingsError = ref(vkPreferencesLoadError())

watch(
  vkRequestedView,
  (requested) => {
    if (!requested) return
    // Navigation commands are one-shot; reopening a view must never replay a
    // full API scan or export just because the last route was 'collect'.
    vkRequestedView.value = null
    if (!hasVerifiedPeer.value && requested !== 'settings') {
      tab.value = 'settings'
      return
    }
    if (requested === 'export') {
      enterTab('reader')
      showUserExportOptions()
    } else if (requested === 'collect') {
      tab.value = 'capture'
      void captureDexie()
    } else enterTab(requested)
  },
  { immediate: true },
)
let unsubscribe: (() => void) | undefined
let peerTimer: ReturnType<typeof setInterval> | undefined
function resetReaderScope() {
  cancelReaderTasks()
  readerGeneration++
  scopeGeneration++
  latestTimelineTarget = null
  stopMediaRequests()
  readerRevision = -1
  readerOwnerId = null
  fixedReading.value = false
  fixedPreview.value = []
  timelineEntries.value = []
  coverage.value = null
  timelineRevision = -1
  timelineGeneration++
  timelineBusy.value = false
  activeMessageId.value = null
  readerFocus.reset()
  rangeStart.value = null
  rangeEnd.value = null
  fixedSaved.value = null
  captureComplete.value = null
  reportedTotal.value = null
  attachmentReferences.value = null
  fixedCursor.value = undefined
  fixedError.value = ''
  nameLookupError.value = ''
  participantNames.value = {}
  for (const file of Object.values(attachments.value)) URL.revokeObjectURL(file.url)
  attachments.value = {}
  downloading.value = {}
  attachmentErrors.value = {}
  clearSelection()
  selectionEnabled.value = false
  exportSelection.value = defaultArchiveExportSelection()
  exportOpen.value = false
  resetPreparedExport()
}
function refreshActiveConversation(next = api?.status()) {
  if (!next) return
  const previous = status.value
  if (previous?.activePeerId !== next.activePeerId) resetReaderScope()
  if (
    !previous ||
    next.activePeerId !== previous.activePeerId ||
    next.blockedReason !== previous.blockedReason ||
    next.options.peerId !== previous.options.peerId
  )
    status.value = next
}
onMounted(() => {
  void refreshCapturePreferences()
  window.addEventListener(SHELL_RESTORE_UI_EVENT, onRestorePreferences)
  unsubscribe = api?.subscribe((next) => {
    const changed = (next.archiveRevision ?? 0) !== savedRevision
    savedRevision = next.archiveRevision ?? 0
    refreshActiveConversation(next)
    status.value = next
    if (changed) {
      resetPreparedExport()
      scheduleSavedRefresh()
    }
  })
  // Detect host SPA peer change while the Control Center is open.
  peerTimer = setInterval(() => refreshActiveConversation(), 1500)
  if (tab.value === 'reader' && hasVerifiedPeer.value) void readDexie()
})
onUnmounted(() => {
  disposed = true
  readerFocus.dispose()
  readerGeneration++
  scopeGeneration++
  stopMediaRequests()
  cancelReaderTasks()
  unsubscribe?.()
  window.removeEventListener(SHELL_RESTORE_UI_EVENT, onRestorePreferences)
  if (savedRefreshTimer !== undefined) clearTimeout(savedRefreshTimer)
  if (peerTimer !== undefined) clearInterval(peerTimer)
  for (const file of Object.values(attachments.value)) URL.revokeObjectURL(file.url)
})
</script>
<template>
  <section class="vk-archive-panel flex min-h-0 min-w-0 flex-col" :class="tab === 'reader' ? 'vk-archive-panel-reader h-full flex-1 overflow-hidden gap-2' : 'gap-3'" :aria-label="text('VK Booster — инструменты')" :data-provider-view="tab" :data-panel-content-focus="tab === 'reader' ? 'false' : undefined">
    <p v-if="status?.blockedReason" class="m-0 flex items-start gap-2 text-sm text-destructive" role="alert">
      <ShieldAlert class="size-4 shrink-0" aria-hidden="true" />
      {{ status.blockedReason }}{{ text('. Вернись в выбранный диалог перед работой с архивом. ') }}</p>
    <Tabs :model-value="tab" class="min-h-0 min-w-0" :class="{ 'flex flex-1 flex-col': tab === 'reader' }" @update:model-value="chooseTab">
    <TabsList v-if="showCatalog !== false" :aria-label="text('Разделы VK Booster')" class="flex h-auto w-full shrink-0 flex-wrap justify-start gap-1">
      <TabsTrigger v-for="item in visibleTabs" :key="item.id" :value="item.id" class="gap-2">
        <component :is="item.icon" class="size-4" aria-hidden="true" />
        {{ text(item.label) }}
      </TabsTrigger>
    </TabsList>
    <!-- Capture and reader share the fixed owner-scoped Dexie repository. -->
    <TabsContent value="capture" class="flex min-w-0 flex-col gap-3">
      <Card class="grid gap-3 p-4" :aria-label="text('Сбор истории VK')">
        <div class="booster-setting-copy">
          <b>{{ text('1 · История переписки') }}</b>
          <span>{{ text('Получает сообщения напрямую через VK API, сохраняет оригиналы в Dexie. Работает в открытом проверенном диалоге, без прокрутки сайта.') }}</span>
        </div>
        <div class="flex flex-wrap gap-2" role="group" :aria-label="text('Объём выгрузки')">
          <Button type="button" size="sm" :variant="captureRange === 'all' ? 'default' : 'outline'"
            :aria-pressed="captureRange === 'all'" :disabled="fixedBusy" @click="captureRange = 'all'">{{ text('Вся история') }}</Button>
          <Button type="button" size="sm" :variant="captureRange === 'recent' ? 'default' : 'outline'"
            :aria-pressed="captureRange === 'recent'" :disabled="fixedBusy" @click="captureRange = 'recent'">{{ text('Последние N') }}</Button>
        </div>
        <Label v-if="captureRange === 'recent'" class="booster-field">{{ text('Сообщений (1–100 000) ') }}<Input :model-value="fixedLimit" type="number" min="1" max="100000" :disabled="fixedBusy" @update:model-value="fixedLimit = Number($event)" @change="saveCaptureOptions" />
        </Label>
        <p v-else class="text-xs text-muted-foreground">{{ text('Без искусственного ограничения в 3000 сообщений. VK может ограничивать частоту API-запросов; при необходимости автоматически делаются паузы.') }}</p>
        <Collapsible v-model:open="speedOpen" class="grid gap-3">
          <CollapsibleTrigger as-child><Button variant="outline" class="justify-between whitespace-normal text-left">{{ text('Скорость и размер запросов') }}<ChevronDown class="size-4" :class="{ 'rotate-180': speedOpen }" /></Button></CollapsibleTrigger>
          <CollapsibleContent class="grid gap-3">
          <Label class="booster-field">{{ text('Сообщений за запрос ') }}<b>{{ requestPageSize }}</b>
            <Slider :model-value="[requestPageSize]" :min="10" :max="100" :step="10" :disabled="fixedBusy" :aria-label="text('Сообщений за запрос')" @update:model-value="requestPageSize = $event?.[0] ?? requestPageSize" @value-commit="saveCaptureOptions" />
          </Label>
          <Label class="booster-field">{{ text('Пауза между запросами ') }}<b>{{ requestDelay }}{{ text(' мс') }}</b>
            <Slider :model-value="[requestDelay]" :min="300" :max="3000" :step="50" :disabled="fixedBusy" :aria-label="text('Пауза между запросами')" @update:model-value="requestDelay = $event?.[0] ?? requestDelay" @value-commit="saveCaptureOptions" />
          </Label>
          <small>{{ text('При ограничении скорости VK запрос повторяется с увеличенной паузой. Значения сохраняются при отпускании слайдера.') }}</small>
          </CollapsibleContent>
        </Collapsible>
        <ConversationCollectionAction :label="captureRange === 'all' ? text('Собрать всю историю') : text('Собрать последние сообщения')"
          :busy="fixedBusy" :disabled="!hasVerifiedPeer"
          :processed="collectionState.processed" :total="collectionState.total"
          :reused="status?.progress.reused ?? 0"
          :saved="collectionState.saved" @start="captureDexie" @stop="collector?.stop()" />
        <p v-if="!hasVerifiedPeer" class="text-sm text-muted-foreground">{{ text('Открой конкретную VK-переписку — на остальных страницах сайта доступны настройки и меню.') }}</p>
        <p v-if="fixedSaved !== null" role="status" class="text-sm">{{ text(' Сохранено новых: ') }}{{ fixedSaved }}{{ text('. Прочитано из VK: ') }}{{ collectionState.processed }}{{ reportedTotal !== null ? `${text('. Всего в истории: ')}${reportedTotal}` : '' }}.
          {{ captureComplete ? text('Вся доступная история сохранена.') : text('Обход частичный: можно продолжить повторным сбором.') }}
          <span v-if="status?.progress.reused">{{ text('Уже проверенный хвост: ') }}{{ status.progress.reused }}{{ text(' сообщений; повторно не загружался.') }}</span>
          <span v-if="status?.progress.updated">{{ text('Новых версий сохранено: ') }}{{ status.progress.updated }}.</span>
        </p>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ text(fixedError) }}</p>
        <p v-if="durableSettingsError" role="alert" class="text-sm text-destructive">{{ text(durableSettingsError) }}</p>
      </Card>
      <Card class="grid gap-3 p-4" :aria-label="text('Догрузка вложений')">
        <div class="booster-setting-copy">
          <b>{{ text('2 · Вложения и файлы') }}</b>
          <span>{{ text('История сохраняет метаданные и ссылки. В архиве можно отдельно загрузить оригинал нужного вложения и включить загруженные файлы в ZIP. Загрузка начинается только по нажатию.') }}</span>
          <small v-if="attachmentReferences !== null">{{ text('Ссылок на вложения верхнего уровня в обработанной истории: ') }}{{ attachmentReferences }}{{ text('. Файлов доступно для экспорта в этом окне: ') }}{{ Object.keys(attachments).length }}.</small>
        </div>
      </Card>
    </TabsContent>
    <TabsContent value="reader" class="vk-reader flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <section class="vk-reader-body flex min-h-0 min-w-0 flex-1 flex-col gap-2" :aria-label="text('Сохранённая переписка')">
        <div class="flex shrink-0 flex-wrap items-center gap-2 px-2 pt-2 max-[620px]:px-1.5" role="toolbar" :aria-label="text('Действия с архивом VK')">
          <Button v-if="timelineNodes.length" variant="outline" size="sm" :aria-pressed="timelineOpen" :aria-expanded="timelineVisible" :aria-controls="timelineId" :aria-label="timelineOpen ? text('Скрыть историю') : text('Показать историю')" @click="timelineOpen = !timelineOpen"><History class="size-4" /><span class="hidden sm:inline">{{ timelineOpen ? text('Скрыть историю') : text('Показать историю') }}</span></Button>
          <Button variant="outline" size="sm" :disabled="fixedBusy || !hasVerifiedPeer" @click="showUserExportOptions">
            <Download class="size-4" />{{ text('Экспорт ') }}</Button>
          <Button variant="outline" size="sm" :aria-pressed="selectionEnabled" :disabled="fixedBusy || rangeBusy" @click="selectionEnabled = !selectionEnabled">{{ text('Выбор сообщений') }}<span v-if="selectedMessageIds.size"> · {{ selectedMessageIds.size }}</span></Button>
          <ArchiveReaderNavigation :first-label="text('К началу')" :last-label="text('К концу')" :compact="false" :disabled="fixedBusy || fixedReading || !timelineEntries.length" @first="navigateTimeline(String(timelineEntries[0]?.id))" @last="navigateTimeline(String(timelineEntries.at(-1)?.id))" />
        </div>
        <div v-if="selectionEnabled" class="flex shrink-0 flex-wrap items-center gap-2 px-2 max-[620px]:px-1.5">
          <Button variant="outline" size="sm" :disabled="fixedBusy || !fixedPreview.length" @click="selectPage">{{ text('Выбрать загруженные') }}</Button>
          <Button variant="ghost" size="sm" :disabled="fixedBusy || !selectedMessageIds.size" @click="clearSelection">{{ text('Очистить выбор') }}</Button>
          <span class="text-xs text-muted-foreground">{{ text('Выбрано сообщений: ') }}{{ selectedMessageIds.size }}{{ text(' · выбор сохраняется при прокрутке архива') }}</span>
          <Button variant="outline" size="sm" :disabled="fixedBusy || rangeBusy || !activeMessageId" @click="markRange('first')">{{ text('Начало диапазона') }}</Button>
          <Button variant="outline" size="sm" :disabled="fixedBusy || rangeBusy || !activeMessageId" @click="markRange('last')">{{ text('Конец диапазона') }}</Button>
          <p v-if="rangeBusy" role="status" class="w-full text-xs"><LoaderCircle class="mr-1 inline size-3 animate-spin" aria-hidden="true" />{{ text('Проверяем все сохранённые сообщения между границами...') }}</p>
          <p v-if="rangeStart || rangeEnd" class="w-full break-words text-xs text-muted-foreground">{{ text('От ') }}{{rangeStart ? `#${rangeStart.id}: ${(rangeStart.text || text('Без текста')).slice(0,100)}` : text('не выбрано')}}{{ text(' до ') }}{{rangeEnd ? `#${rangeEnd.id}: ${(rangeEnd.text || text('Без текста')).slice(0,100)}` : text('не выбрано')}}{{ text('. Границы можно выбирать на разных страницах таймлайна.') }}</p>
        </div>
        <Collapsible v-if="coverage" v-model:open="coverageOpen" class="shrink-0 min-w-0 border-y py-1" data-vk-reader-summary>
          <CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="w-full justify-between gap-2 whitespace-normal text-left">{{ text('Сохранено ') }}{{coverage.savedCount}} · {{coverage.integrity.chain === 'verified' ? text('Обход подтверждён') : text('Полнота не подтверждена')}}<ChevronDown class="size-4 shrink-0" :class="{'rotate-180':coverageOpen}" /></Button></CollapsibleTrigger>
          <CollapsibleContent class="grid max-h-48 gap-2 overflow-y-auto px-3 py-2" :aria-label="text('Проверка полноты истории')">
          <p class="text-sm font-medium">{{coverage.integrity.chain === 'verified' ? text('Наблюдаемый обход VK подтверждён') : text('Полнота удалённой истории не подтверждена')}}</p>
          <p class="text-xs text-muted-foreground">{{ text('Сохранено ') }}{{coverage.savedCount}}{{coverage.reportedCount !== null ? `${text('; VK сообщил ')}${coverage.reportedCount}` : ''}}{{ text('. Начало: ') }}{{coverage.integrity.start === 'verified' ? text('подтверждено') : text('не проверено')}}{{ text('; конец: ') }}{{coverage.integrity.end === 'verified' ? text('подтверждён') : text('не проверен')}}{{ text('. Промежутки между числовыми ID сами по себе не доказывают пропуски.') }}</p>
          <div class="flex flex-wrap gap-2">
            <Button v-if="coverage.first" variant="outline" size="sm" @click="navigateTimeline(String(coverage.first.id))">{{ text('Первое сохранённое · #') }}{{coverage.first.id}}</Button>
            <Button v-if="coverage.last" variant="outline" size="sm" @click="navigateTimeline(String(coverage.last.id))">{{ text('Последнее сохранённое · #') }}{{coverage.last.id}}</Button>
            <Button variant="ghost" size="sm" @click="captureRange = 'all'; enterTab('capture')">{{ text('Сбор и проверка истории') }}</Button>
          </div>
          <small class="text-muted-foreground">{{coverage.observedAtMs ? `${text('Проверка текущего сеанса: ')}${new Date(coverage.observedAtMs).toLocaleString(locale)}${text('. Это наблюдаемый обход API, не неизменяемый снимок сервера.')}` : text('После перезапуска прежние границы остаются непроверенными. Сохранённые оригиналы не меняются.')}}</small>
          </CollapsibleContent>
        </Collapsible>
        <p v-if="!fixedReading && !fixedPreview.length && !fixedError" class="text-sm text-muted-foreground" role="status">{{ text(' В этой переписке ещё нет сохранённых сообщений. ') }}</p>
        <p v-if="nameLookupError" class="text-xs text-muted-foreground">{{ text(nameLookupError) }}</p>
        <ArchiveReadingSurface :timeline-visible="timelineVisible">
        <div ref="readerViewport" :aria-label="text('Сохранённые сообщения')" class="vk-reader-transcript h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain p-2" @scroll.passive="onReadingScroll" @wheel.passive="readerScroll.onUserInput" @touchmove.passive="readerScroll.onUserInput" @pointerdown="readerScroll.onUserInput" @pointermove.passive="readerScroll.onUserInput" @keydown="readerScroll.onUserInput">
          <ArchiveRecordList :records="fixedPreview" :record-key="messageKey" :message-id="messageId"
            :target-message-id="activeMessageId"
            :highlight-target="false"
            spaced
            :selectable="selectionEnabled" :selected-ids="selectedRecordIds"
            :selection-label="selectionLabel" :disabled="fixedBusy || rangeBusy" @select="selectMessage">
          <template #record="{ record: message }">
          <article
            class="flex min-w-0"
            :class="message.out === 1 || message.out === true ? 'justify-end' : 'justify-start'"
          >
            <Card class="min-w-0 max-w-[88%] p-3 shadow-none"
              :class="[message.out === 1 || message.out === true ? 'bg-primary/10' : 'bg-muted/45', { 'booster-message-target': String(message.id) === activeMessageId }]">
              <ArchiveMessageHeader :author="senderName(message)" :sent-at="message.date"
                :metadata="message" :inspect-label="text('Все исходные метаданные сообщения')" />
              <p v-if="message.text" class="mt-2 whitespace-pre-wrap break-words text-sm">{{ message.text }}</p>
              <p v-else class="mt-2 text-xs text-muted-foreground">{{ text('Сообщение без текста') }}</p>
              <div v-for="asset in messageMedia(message)" :key="asset.key" :data-asset-type="asset.type" class="mt-2 flex min-w-0 flex-col gap-1 border-t border-border pt-2">
                <img v-if="asset.type === 'photo' && attachments[asset.key]"
                  :src="attachments[asset.key]?.url" :alt="attachments[asset.key]?.name || text('Фото из сообщения')"
                  class="max-h-64 max-w-full rounded-md object-contain" loading="lazy" referrerpolicy="no-referrer" />
                <small class="break-words text-muted-foreground">{{ asset.type }} · {{ asset.choices[0]?.name || text('Вложение') }}
                  · {{ attachments[asset.key] ? text('загружено в текущем сеансе') : asset.choices.length ? text('оригинал не загружен') : text('Нет отдельного файла в сохранённых данных') }}</small>
                <Button v-if="asset.external" as-child size="sm" variant="link" class="justify-start p-0"><a :href="asset.external" target="_blank" rel="noopener noreferrer">{{ text('Открыть публикацию VK') }}</a></Button>
                <Button v-if="asset.choices.length && !attachments[asset.key]" size="sm" variant="outline"
                  :disabled="downloading[asset.key] || !hasVerifiedPeer" @click="requestMedia(message.id,asset)">
                  <LoaderCircle v-if="downloading[asset.key]" class="size-3.5 animate-spin" aria-hidden="true" />
                  {{ downloading[asset.key] ? text('Загрузка...') : text('Загрузить оригинал') }}
                </Button>
                <Button v-else-if="attachments[asset.key]" as-child variant="link" size="sm" class="justify-start p-0"><a :href="attachments[asset.key]?.url" :download="attachments[asset.key]?.name">{{ text('Скачать загруженный файл') }}</a></Button>
                <small v-if="attachmentErrors[asset.key]" class="text-destructive" role="alert">{{ text(attachmentErrors[asset.key] ?? '') }}</small>
              </div>
            </Card>
          </article>
          </template>
          </ArchiveRecordList>
        </div>
        <template #timeline><ArchiveTimeline :id="timelineId" :nodes="timelineNodes" :active-id="activeMessageId" :selected-ids="selectedRecordIds" :label="text('Таймлайн всех сохранённых сообщений VK')" :empty-label="text('Сохранённых точек таймлайна пока нет')" :uncertain-label="text('Неподтверждённая связь')" :loading="fixedReading || timelineBusy" :disabled="fixedBusy" @navigate="navigateTimeline" /></template>
        <template #status><div v-if="fixedReading" class="pointer-events-none absolute inset-x-2 top-1 flex justify-center" role="status"><span class="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-1 text-xs text-popover-foreground"><LoaderCircle class="size-3 animate-spin" />{{ text('Загружаем сохранённые сообщения...') }}</span></div></template>
        </ArchiveReadingSurface>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ text(fixedError) }}</p>
      </section>
    </TabsContent>
    <TabsContent value="settings" class="flex min-w-0 flex-col gap-3">
      <Card class="grid gap-3 p-4" :aria-label="text('Постоянные параметры VK')">
        <div class="booster-setting-copy">
          <b>{{ text('Параметры сохранения') }}</b>
          <small>{{ text('Размер пачки, пауза и число сообщений сохраняются при изменении и восстанавливаются при следующем запуске.') }}</small>
        </div>
        <Label class="booster-field">{{ text('Последние N сообщений ') }}<Input :model-value="fixedLimit" type="number" min="1" max="100000" :disabled="fixedBusy" @update:model-value="fixedLimit = Number($event)" @change="saveCaptureOptions" />
        </Label>
        <Label class="booster-field">{{ text('Размер запроса VK: ') }}{{ requestPageSize }}
          <Slider :model-value="[requestPageSize]" :min="10" :max="100" :step="10" :disabled="fixedBusy" :aria-label="text('Размер запроса VK')" @update:model-value="requestPageSize = $event?.[0] ?? requestPageSize" @value-commit="saveCaptureOptions" />
        </Label>
        <Label class="booster-field">{{ text('Пауза между страницами: ') }}{{ requestDelay }}{{ text(' мс ') }}<Slider :model-value="[requestDelay]" :min="300" :max="3000" :step="50" :disabled="fixedBusy" :aria-label="text('Пауза между страницами')" @update:model-value="requestDelay = $event?.[0] ?? requestDelay" @value-commit="saveCaptureOptions" />
        </Label>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" :disabled="fixedBusy" @click="saveCaptureOptions">{{ text('Сохранить параметры') }}</Button>
          <small class="text-muted-foreground">{{ text('Сохраняются отдельно от сообщений Dexie и не включают токены.') }}</small>
        </div>
        <p v-if="durableSettingsError" role="alert" class="m-0 text-sm text-destructive">{{ text(durableSettingsError) }}</p>
      </Card>
    </TabsContent>
    </Tabs>
    <ModalSurface v-if="exportOpen" :label="text('Экспорт сохранённых сообщений VK')" @close="!fixedBusy && (exportOpen = false)">
      <div class="grid min-w-0 gap-3 p-4" :aria-label="text('Параметры пользовательского экспорта')">
        <div class="booster-setting-copy">
          <b>{{ text('Экспорт сохранённых сообщений') }}</b>
          <span>{{ text('Выберите сообщения и формат файла.') }}</span>
        </div>
        <ArchiveExportScopeFields v-model="exportSelection" v-model:selected-ids="exportSelectedIds" :messages="exportMessages" :loading="timelineBusy || exportScopeStale" :disabled="fixedBusy || rangeBusy" />
        <ArchiveExportFormatFields :format="exportFormat" :packaging="exportPackaging" :formats="exportFormats.map(choice => ({ ...choice, label: text(choice.label) }))" :packages="exportPackages.map(choice => ({ ...choice, label: text(choice.label) }))" :format-label="text('Формат экспорта сообщений')" :packaging-label="text('Упаковка экспорта')" :disabled="fixedBusy"
          @update:format="exportFormat = $event === 'markdown' || $event === 'text' ? $event : 'json'" @update:packaging="exportPackaging = $event === 'none' ? 'none' : 'zip'" />
        <Collapsible v-model:open="exportAdvanced" class="grid gap-3">
        <CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="justify-between">{{ text('Дополнительно') }}<ChevronDown class="size-4" :class="{'rotate-180':exportAdvanced}" /></Button></CollapsibleTrigger>
        <CollapsibleContent class="grid gap-3">
        <Label v-if="exportPackaging === 'zip'" class="booster-field">{{ text('Сообщений в одном JSON-файле ') }}<Select :model-value="String(exportChunkRows)" :disabled="fixedBusy" @update:model-value="chooseChunkRows"><SelectTrigger :aria-label="text('Сообщений в одном JSON-файле')"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="100">100</SelectItem><SelectItem value="500">500</SelectItem></SelectContent></Select>
        </Label>
        <Label v-if="exportPackaging === 'none' && exportFormat !== 'json'" class="flex items-center justify-between gap-3 text-sm">{{ text('Добавить исходный JSON в читаемый файл ') }}<Switch :model-value="exportIncludeOriginal" :disabled="fixedBusy" :aria-label="text('Добавить исходный JSON')" @update:model-value="exportIncludeOriginal = $event" />
        </Label>
        <Label v-if="exportPackaging === 'zip'" class="flex items-center justify-between gap-3 text-sm">{{ text('Включить загруженные оригиналы вложений ') }}<Switch :model-value="exportIncludeMedia" :disabled="fixedBusy" :aria-label="text('Включить файлы вложений в ZIP')" @update:model-value="exportIncludeMedia = $event" />
        </Label>
        <Label v-if="exportPackaging === 'zip'" class="flex items-center gap-2 text-sm">
          <Checkbox :model-value="exportIncludeReferences" :disabled="fixedBusy" @update:model-value="exportIncludeReferences = $event === true; resetPreparedExport()" />{{ text(' Добавить manifest вложений в папку attachments/ ') }}</Label>
        </CollapsibleContent></Collapsible>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="fixedBusy || rangeBusy || !hasVerifiedPeer || exportScopeEmpty || exportScopeStale" @click="prepareUserExport">
            <LoaderCircle v-if="fixedBusy" class="size-4 animate-spin" aria-hidden="true" />
            {{ fixedBusy ? text('Подготавливаем файл...') : text('Подготовить экспорт') }}
          </Button>
          <Button v-if="exportPrepared" variant="outline" :disabled="fixedBusy" @click="downloadPreparedExport">{{ text(' Скачать ') }}{{ exportPrepared.extension.toUpperCase() }} · {{ Math.ceil(exportPrepared.blob.size / 1024) }}{{ text(' КиБ ') }}</Button>
          <Button size="sm" variant="ghost" :disabled="fixedBusy" @click="exportOpen = false">{{ text('Закрыть параметры') }}</Button>
        </div>
        <ArchiveProgressBar v-if="exportProgress" :label="exportProgress.phase === 'reading' ? text('Читаем архив') : text('Готовим файл')"
          :percent="exportProgress.total ? Math.round(exportProgress.done / exportProgress.total * 100) : null"
          :counter="`${exportProgress.done}${text(' из ')}${exportProgress.total}`" />
        <p v-if="exportPrepared" role="status" class="text-sm">{{ text('Подготовлено сообщений: ') }}{{ exportPrepared.recordCount }}{{ text('. Файлов вложений: ') }}{{ exportPrepared.attachmentFilesIncluded }}{{ text('. Файл сохранится после нажатия «Скачать».') }}</p>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ text(fixedError) }}</p>
      </div>
    </ModalSurface>
  </section>
</template>
