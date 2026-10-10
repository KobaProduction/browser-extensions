<script setup lang="ts">
import { ARCHIVE_UPDATED_EVENT, type ArchiveThreadView, type ArchiveMessageLocation } from '@chatgpt-booster/core'
import ArrowLeft from 'lucide-vue-next/dist/esm/icons/arrow-left.js'
import Search from 'lucide-vue-next/dist/esm/icons/search.js'
import Info from 'lucide-vue-next/dist/esm/icons/info.js'
import Brain from 'lucide-vue-next/dist/esm/icons/brain.js'
import Database from 'lucide-vue-next/dist/esm/icons/database.js'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import GitBranch from 'lucide-vue-next/dist/esm/icons/git-branch.js'
import GripHorizontal from 'lucide-vue-next/dist/esm/icons/grip-horizontal.js'
import LoaderCircle from 'lucide-vue-next/dist/esm/icons/loader-circle.js'
import Minus from 'lucide-vue-next/dist/esm/icons/minus.js'
import RefreshCw from 'lucide-vue-next/dist/esm/icons/refresh-cw.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArchiveConversationList, ArchiveTranscript, useArchiveFocusTracker, type ArchiveConversationGroup } from '@kobaproduction/browser-widgets'
import ArchiveRecord from './ArchiveRecord.vue'
import {projectArchiveTranscript} from './archive-transcript-adapter'
import {useArchiveWindowSession} from './archive-window-session'
import ArchiveFlowGraph from './ArchiveFlowGraph.vue'
import {
  archiveConversationForest,
  archiveTurnWindow,
  ARCHIVE_INITIAL_TURNS,
  ARCHIVE_TURN_BATCH,
  type ArchiveReadingOrder,
} from './archive-navigation'
import CopyIdentity from './CopyIdentity.vue'
import { archiveForkChoices } from './archive-fork-choices'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type {
  ArchiveConversationView,
  ArchiveProjectView,
  ArchiveCoverageView,
  ArchiveDataAdapter,
  ArchiveThreadWindow,
} from './mount'

const props = defineProps<{
  archiveAdapter: ArchiveDataAdapter
  initialConversationId?: string | null | undefined
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
  export: [conversationId: string, title: string | null]
}>()
const t = (key: TranslationKey) => translate(props.locale, key)
const conversations = ref<ArchiveConversationView[]>([])
const projects = ref<ArchiveProjectView[]>([])
const selectedId = ref<string | null>(props.initialConversationId ?? null)
const thread = ref<ArchiveThreadView>({ turns: [], messageCount: 0, recordCount: 0, detailCount: 0 })
const coverage = ref<ArchiveCoverageView>()
const listLoading = ref(false)
const threadLoading = ref(false)
const error = ref(false)
const staleSavedWindow = ref(false)
const navigationError = ref<TranslationKey | null>(null)
const requestedMessageId = ref<string | null>(null)
const messageLookup = ref('')
const messageLookupOpen = ref(false)
const session=useArchiveWindowSession()
const {
  readSource,readAccountId,readRevision,readInstanceId,unsequencedTarget,requestedLocation,
  olderStoredCursor,newerStoredCursor,hasOlderStored,hasNewerStored,
  usingIndexedWindows,knownStoredCount,hasUnsequencedRecords,
}=session
let windowController: AbortController | undefined
let sourceUnsubscribe: (() => void) | undefined
let interruptedLoad = false
const mobileList = ref(!props.initialConversationId)
const search = ref('')
const textSearch = ref('')
const visibleCount = ref(ARCHIVE_INITIAL_TURNS)
const readingOrder = ref<ArchiveReadingOrder>('chronological')
const searchOpen = ref(false)
const forksOpen = ref(false)
const historyOpen = ref(false)
const windowCenter = ref<number | null>(null)
const loadingOlder = ref(false)
const loadingDirection = ref<'older' | 'newer'>('older')
const loadedEdge = ref<'first' | 'latest'>('latest')
const readingScroll = ref<HTMLElement | null>(null)
const focus=useArchiveFocusTracker(()=>readingScroll.value,()=>!resettingPosition)
const {activeMessageKey}=focus
const scheduleReadFocus=focus.schedule
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
let contextUnsubscribe: (() => void) | undefined
let contextFallbackTimer: ReturnType<typeof setInterval> | undefined

const NONE = '__outside_projects__'
const selected = computed(() =>
  conversations.value.find((conversation) => conversation.conversationId === selectedId.value) ??
  (selectedId.value ? { conversationId: selectedId.value, projectId: null, title: null,
    branchSourceConversationId: null, branchSourceTitle: null } : undefined),
)
const projectLabel = (id: string | null) =>
  id
    ? projects.value.find((project) => project.projectId === id)?.title ||
      t('identity.unknownProject')
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
    return rows.length ? [{ id, rows, count: items.length, label }] : []
  })
})

const sidebarGroups = computed<ArchiveConversationGroup[]>(() =>
  groups.value.map(group => ({
    id: group.id, label: group.label, count: group.count,
    rows: group.rows.map(entry => ({
      id: entry.conversation.conversationId,
      title: entry.conversation.title ?? '',
      depth: entry.depth,
      branched: entry.branched,
      sourceMissing: entry.sourceMissing,
    })),
  })),
)
const sidebarCopy = computed(() => ({
  search: t('reader.search'), loading: t('reader.loading'),
  empty: props.archiveAdapter.archiveGeneration === 4
    ? props.locale === 'ru'
      ? 'Новый архив v4 пока пуст. Старые локальные данные v3 не перенесены; историю можно заново собрать из ChatGPT.'
      : 'The new v4 archive is empty. Previous local v3 data was not migrated; collect history again from ChatGPT.'
    : t('reader.empty'),
  noResults: t('reader.noResults'), untitled: t('identity.untitled'),
  missingBranch: t('reader.branchMissing'),
}))

const filteredTurns = computed(() => {
  const term = textSearch.value.trim().toLocaleLowerCase()
  if (!term) return thread.value.turns
  return thread.value.turns.filter((turn) =>
    [...turn.messages, ...turn.details].some((item) =>
      (item.text + ' ' + (item.record.recipient ?? '')).toLocaleLowerCase().includes(term),
    ),
  )
})
const displayedTurns = computed(() => {
  if (windowCenter.value !== null) {
    const offset = Math.max(0, Math.min(filteredTurns.value.length - 1, windowCenter.value))
    const turns = filteredTurns.value.slice(Math.max(0, offset - 20), Math.min(filteredTurns.value.length, offset + 20))
    return readingOrder.value === 'newest-first' ? [...turns].reverse() : turns
  }
  return archiveTurnWindow(filteredTurns.value, visibleCount.value, readingOrder.value)
})
const transcript = computed(() => projectArchiveTranscript(displayedTurns.value))
const transcriptCopy = computed(() => ({
  empty:t('reader.noResults'),
  unassigned:t('reader.unassigned'),
  adjacency:t('reader.adjacency'),
  details:t('reader.details'),
}))
const forkChoices = computed(() => archiveForkChoices(thread.value))
const navigationNodes = computed(() =>
  thread.value.turns.flatMap(turn => turn.messages.filter(item => item.kind === 'user' || item.kind === 'answer')),
)
const archiveStatusKey = computed<TranslationKey>(() =>
  coverage.value?.completeAtLastRead ? 'reader.savedToStart' : 'reader.savedPartial',
)

const windowRequest=session.windowRequest
function acceptWindow(result:ArchiveThreadWindow){
  thread.value=result.thread
  session.acceptWindow(result)
}
function cancelWindowWork() {
  windowController?.abort()
  windowController = undefined
  threadRevision++; scrollRevision++; windowShiftRevision++
  loadingOlder.value = false
  threadLoading.value = false
  resettingPosition = false
}
function describeReadFailure(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'AbortError') return
  const key = cause instanceof Error ? cause.message : ''
  staleSavedWindow.value = key === 'archive.error.sourceChanged'
  navigationError.value = key === 'archive.error.messageMissing' ? 'reader.messageMissing'
    : key === 'archive.error.auth' ? 'archive.error.auth'
    : key === 'archive.error.incompatibleSource' ? 'archive.error.incompatibleSource' : null
  error.value = !staleSavedWindow.value && !navigationError.value
}
function bindSourceChanges(id: string) {
  sourceUnsubscribe?.()
  sourceUnsubscribe = props.archiveAdapter.subscribeExportChanges?.(id, () => {
    if (readSource.value !== 'saved' || selectedId.value !== id) return
    // Keep the inspected copy visible, but never concatenate a changed revision.
    cancelWindowWork()
    staleSavedWindow.value = true
  })
}
async function focusMessage(messageId: string) {
  const revision = threadRevision
  const id = selectedId.value
  const owns = () => alive && revision === threadRevision && selectedId.value === id
  const item = thread.value.turns.flatMap(turn => [...turn.messages, ...turn.details])
    .find(value => value.record.messageId === messageId)
  if (!item) throw new Error('archive.error.messageMissing')
  suppressSearchReset = true
  textSearch.value = ''
  await nextTick()
  suppressSearchReset = false
  if (!owns()) return
  requestedMessageId.value = messageId
  focus.pin(item.record.messageKey)
  windowCenter.value = null
  visibleCount.value = thread.value.turns.length
  resettingPosition = true
  await nextTick()
  if (!owns()) return
  const element = [...(readingScroll.value?.querySelectorAll<HTMLElement>('[data-archive-message]') ?? [])]
    .find(node => node.dataset.archiveMessage === messageId)
  if (element && !props.suspended) {
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    element.focus({ preventScroll: true })
  }
  resettingPosition = false
  scheduleReadFocus()
}
async function openMessage(messageId: string, location?: ArchiveMessageLocation, refreshRevision = false) {
  if (!props.archiveAdapter.getMessageWindow) return
  const id = location?.conversationId ?? selectedId.value
  if (!id || !messageId.trim()) return
  selectedId.value = id
  mobileList.value = false
  forksOpen.value = false
  requestedMessageId.value = messageId.trim()
  messageLookup.value = messageId.trim()
  if (location) {
    session.useSavedLocation(location,refreshRevision)
  } else {
    if (requestedLocation.value) requestedLocation.value = { ...requestedLocation.value, messageId: messageId.trim() }
    if (refreshRevision) { readRevision.value = null; readInstanceId.value = null }
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
  if (requestedMessageId.value)
    void openMessage(requestedMessageId.value, requestedLocation.value ?? undefined, true)
  else { readRevision.value = null; readInstanceId.value = null; void refresh() }
}
watch(() => props.navigationTarget, (target) => {
  if (!target || !initialized) return
  void openMessage(target.messageId, target)
})
watch(() => props.suspended, (hidden) => {
  if (hidden) {
    interruptedLoad = threadLoading.value
    cancelWindowWork()
  } else if (interruptedLoad) {
    interruptedLoad = false
    if (requestedMessageId.value) void openMessage(requestedMessageId.value, requestedLocation.value ?? undefined)
    else void loadThread(selectedId.value)
  }
})

function toggleGroup(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}
function date(value?: number | null) {
  return value ? new Date(value).toLocaleString(props.locale) : ''
}

/** Reset each new view to its latest exchange, without moving the pinned controls. */
async function resetReadingPosition(edge: 'first' | 'latest' = loadedEdge.value) {
  const ticket = ++scrollRevision
  resettingPosition = true
  visibleCount.value = edge === 'first' ? thread.value.turns.length : ARCHIVE_INITIAL_TURNS
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
  if (edge === 'first') {
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
  if (!viewport || loadingOlder.value || threadLoading.value || !moreStored ||
      staleSavedWindow.value || props.suspended) return
  windowController?.abort()
  const controller = new AbortController()
  windowController = controller
  const ticket = scrollRevision
  const conversation = selectedId.value
  const beforeHeight = viewport.scrollHeight
  const beforeTop = viewport.scrollTop
  const bounds = viewport.getBoundingClientRect()
  const firstVisible = [...viewport.querySelectorAll<HTMLElement>('[data-archive-node]')]
    .find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
  const anchorKey = firstVisible?.dataset.archiveNode
  const anchorOffset = firstVisible ? firstVisible.getBoundingClientRect().top - bounds.top : null
  loadingDirection.value = direction
  loadingOlder.value = true
  try {
    await paintLoadingStatus()
    if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
    if (usingIndexedWindows.value && conversation && props.archiveAdapter.getThreadWindow) {
      const cursor = direction === 'older' ? olderStoredCursor.value : newerStoredCursor.value
      if (!cursor) return
      const result = await props.archiveAdapter.getThreadWindow(conversation, cursor, direction, windowRequest(controller))
      if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
      if (controller.signal.aborted) return
      acceptWindow(result)
      // A focused sub-window must not trap navigation inside already retained turns.
      windowCenter.value = null
      visibleCount.value = thread.value.turns.length
    }
    await nextTick()
    if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
    const retainedAnchor = anchorKey
      ? [...viewport.querySelectorAll<HTMLElement>('[data-archive-node]')]
          .find((element) => element.dataset.archiveNode === anchorKey)
      : undefined
    if (retainedAnchor && anchorOffset !== null) {
      const nextOffset = retainedAnchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      viewport.scrollTop += nextOffset - anchorOffset
    } else if (hasNewerStored.value) {
      // When newest records are discarded, whole-scroll-height changes also
      // include the trimmed bottom. They cannot be used to anchor the top.
      viewport.scrollTop = beforeTop
    } else if (readingOrder.value === 'chronological')
      viewport.scrollTop = beforeTop + viewport.scrollHeight - beforeHeight
    else viewport.scrollTop = beforeTop
  } catch (cause) {
    if (alive && ticket === scrollRevision) {
      describeReadFailure(cause)
    }
  } finally {
    if (windowController === controller) windowController = undefined
    if (alive && ticket === scrollRevision) loadingOlder.value = false
  }
}

function onReadingScroll() {
  const viewport = readingScroll.value
  if (!viewport || resettingPosition || props.suspended || staleSavedWindow.value) return
  scheduleReadFocus()
  const atTop = viewport.scrollTop < 100
  const atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 100
  const olderEdge = readingOrder.value === 'chronological' ? atTop : atBottom
  const newerEdge = readingOrder.value === 'chronological' ? atBottom : atTop
  if (windowCenter.value !== null) {
    if (loadingOlder.value) return
    if (olderEdge && windowCenter.value > 20) void shiftWindow(-20)
    else if (newerEdge && windowCenter.value + 20 < filteredTurns.value.length) void shiftWindow(20)
    else if (olderEdge && hasOlderStored.value) void loadAdjacent('older')
    else if (newerEdge && hasNewerStored.value) void loadAdjacent('newer')
    return
  }
  if (loadingOlder.value) return
  if (olderEdge && hasOlderStored.value) void loadAdjacent('older')
  else if (newerEdge && hasNewerStored.value) void loadAdjacent('newer')
  else if (olderEdge && filteredTurns.value.length > visibleCount.value)
    visibleCount.value = Math.min(filteredTurns.value.length, visibleCount.value + ARCHIVE_TURN_BATCH)
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
  if (!alive || ticket !== windowShiftRevision || selectedId.value !== conversation || windowCenter.value === null) return
  windowCenter.value = Math.max(0, Math.min(filteredTurns.value.length - 1, windowCenter.value + amount))
  await nextTick()
  if (!alive || ticket !== windowShiftRevision || selectedId.value !== conversation) return
  if (amount < 0) viewport.scrollTop = beforeTop + viewport.scrollHeight - beforeHeight
  else viewport.scrollTop = Math.max(0, beforeTop - (beforeHeight - viewport.scrollHeight))
  loadingOlder.value = false
}
async function navigateToMessageKey(key: string) {
  const index = navigationNodes.value.findIndex((item) => item.record.messageKey === key)
  if (index < 0) return
  await navigateToNode(index)
  forksOpen.value = false
}
async function navigateToNode(index: number) {
  const total = navigationNodes.value.length
  if (!total) return
  const safe = Math.max(0, Math.min(total - 1, index))
  const item = navigationNodes.value[safe]
  if (!item) return
  let turnIndex = filteredTurns.value.findIndex(turn => turn.messages.some(message => message.record.messageKey === item.record.messageKey))
  if (turnIndex < 0 && textSearch.value) {
    suppressSearchReset = true
    textSearch.value = ''
    await nextTick()
    suppressSearchReset = false
    turnIndex = filteredTurns.value.findIndex(turn => turn.messages.some(message => message.record.messageKey === item.record.messageKey))
  }
  if (turnIndex < 0) return
  focus.pin(item.record.messageKey)
  windowCenter.value = turnIndex
  await nextTick()
  const target = [...(readingScroll.value?.querySelectorAll<HTMLElement>('[data-archive-node]') ?? [])].find(x => x.dataset.archiveNode === item.record.messageKey)
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' })
  else if (readingScroll.value) {
    const viewport = readingScroll.value
    viewport.scrollTop = safe / Math.max(1, total - 1) * (viewport.scrollHeight - viewport.clientHeight)
  }
  onReadingScroll()
}
watch(textSearch, () => { if (!suppressSearchReset) void resetReadingPosition() })
watch(readingOrder, () => {
  if (requestedMessageId.value && !textSearch.value) void focusMessage(requestedMessageId.value).catch(() => undefined)
  else void resetReadingPosition()
})

watch(
  () => props.initialConversationId,
  (next) => {
    if (!next || next === selectedId.value || props.navigationTarget?.conversationId === next) return
    session.resetSource()
    selectedId.value = next
    textSearch.value = ''
    mobileList.value = false
    void loadThread(next)
  },
)


async function loadThread(id: string | null, edge: 'first' | 'latest' = props.openPosition ?? 'latest',
  focusId: string | null = null) {
  cancelWindowWork()
  const revision = ++threadRevision
  const controller = new AbortController()
  windowController = controller
  requestedMessageId.value = focusId
  thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }
  focus.reset(); coverage.value = undefined
  visibleCount.value = ARCHIVE_INITIAL_TURNS; windowCenter.value = null
  session.clearWindow()
  if (!id) return
  bindSourceChanges(id)
  threadLoading.value = true; loadedEdge.value = edge
  error.value = false; staleSavedWindow.value = false; navigationError.value = null
  const owns = () => alive && !controller.signal.aborted && revision === threadRevision && selectedId.value === id
  try {
    await paintLoadingStatus()
    if (!owns()) return
    const request = windowRequest(controller)
    const loaded = focusId && props.archiveAdapter.getMessageWindow
      ? await props.archiveAdapter.getMessageWindow(id, focusId, request)
      : props.archiveAdapter.getThreadWindow
        ? await props.archiveAdapter.getThreadWindow(id, null, edge === 'first' ? 'first' : 'older', request)
        : await props.archiveAdapter.getThread(id)
    if (!owns()) return
    if ('thread' in loaded) acceptWindow(loaded)
    else thread.value = loaded
    threadLoading.value = false
    if (focusId) await focusMessage(focusId)
    else await resetReadingPosition(edge)
    if (!owns()) return
    // Coverage/header refresh may lag; it never gates displaying the bounded records.
    void props.archiveAdapter.getCoverage(id, windowRequest(controller)).then(value => {
      if (owns()) coverage.value = value
    }).catch(() => undefined)
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
  requestedLocation.value = null; readRevision.value = null; readInstanceId.value = null
  void loadThread(selectedId.value, 'latest')
}
function returnToFirstKnown() {
  if (!selectedId.value || !props.archiveAdapter.getThreadWindow) return
  textSearch.value = ''
  requestedLocation.value = null; readRevision.value = null; readInstanceId.value = null
  void loadThread(selectedId.value, 'first')
}
function select(id: string) {
  session.resetSource()
  ++windowShiftRevision
  selectedId.value = id
  mobileList.value = false
  textSearch.value = ''
  forksOpen.value = false
  historyOpen.value = false
  void loadThread(id)
}
async function refresh() {
  const revision = ++listRevision
  listLoading.value = true
  error.value = false
  try {
    const [cs, ps] = await Promise.all([
      props.archiveAdapter.listConversations(),
      props.archiveAdapter.listProjects(),
    ])
    if (!alive || revision !== listRevision) return
    conversations.value = cs
    projects.value = ps
    if (!initialized) {
      if (props.navigationTarget) {
        selectedId.value = props.navigationTarget.conversationId
        requestedLocation.value = props.navigationTarget
      }
      if (!selectedId.value) selectedId.value = cs[0]?.conversationId ?? null
      const projectId =
        cs.find((c) => c.conversationId === selectedId.value)?.projectId ??
        props.archiveAdapter.currentProjectId()
      expanded.value = new Set([projectId ?? NONE])
      initialized = true
    }
    const target = requestedLocation.value
    if (target && target.conversationId === selectedId.value)
      await openMessage(target.messageId, target)
    else await loadThread(selectedId.value)
  } catch (cause) {
    if (alive && revision === listRevision) describeReadFailure(cause)
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
  let owner = props.archiveAdapter.currentAccountId?.() ?? null
  const syncContext = () => {
    const next = props.archiveAdapter.currentConversationId()
    const nextOwner = props.archiveAdapter.currentAccountId?.() ?? null
    if (nextOwner !== owner) {
      owner = nextOwner
      listRevision++
      cancelWindowWork()
      sourceUnsubscribe?.(); sourceUnsubscribe = undefined
      conversations.value = []; projects.value = []; thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }
      coverage.value = undefined
      navigationError.value = 'archive.error.auth'
      staleSavedWindow.value = false
      return
    }
    if (!next || next === current) return
    current = next
    if (readSource.value === 'saved') return
    const conversation = conversations.value.find((item) => item.conversationId === next)
    selectedId.value = next
    if (conversation) expanded.value = new Set([conversation.projectId ?? NONE])
    textSearch.value = ''
    void loadThread(next)
  }
  window.addEventListener(ARCHIVE_UPDATED_EVENT, refreshConversationTitles)
  if (props.archiveAdapter.subscribeContextChange)
    contextUnsubscribe = props.archiveAdapter.subscribeContextChange(syncContext)
  else contextFallbackTimer = setInterval(syncContext, 450)
  await refresh()
  if (alive) syncContext()
})
onBeforeUnmount(() => {
  alive = false
  cancelWindowWork()
  sourceUnsubscribe?.()
  listRevision++
  threadRevision++
  scrollRevision++
  windowShiftRevision++
  contextUnsubscribe?.()
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, refreshConversationTitles)
  focus.dispose()
  if (contextFallbackTimer) clearInterval(contextFallbackTimer)
})
</script>

<template>
  <div class="booster-reader" :lang="locale" :class="{ 'booster-reader-list-mode': mobileList }">
    <header class="booster-section-header" :data-archive-drag-handle="windowed ? '' : undefined">
      <div class="booster-reader-heading">
        <GripHorizontal v-if="windowed" class="booster-archive-grip size-4" />
        <Database class="size-5" />
        <div><strong>{{ t('reader.title') }}</strong><p>{{ t('reader.readonly') }}</p></div>
      </div>
      <div class="booster-header-actions">
        <button v-if="canReturnToExport" type="button" class="booster-action-secondary" @click="emit('returnExport')"><ArrowLeft class="size-4" />{{ t('reader.returnExport') }}</button>
        <button type="button" class="booster-icon-button" :disabled="listLoading" :title="t('reader.refresh')" :aria-label="t('reader.refresh')" @click="retryLocation"><RefreshCw class="size-4" /></button>
        <button v-if="windowed" type="button" class="booster-icon-button" :title="t('reader.minimize')" :aria-label="t('reader.minimize')" @click="emit('minimize')"><Minus class="size-4" /></button>
        <button type="button" class="booster-icon-button" :aria-label="t('reader.close')" @click="emit('close')"><X class="size-4" /></button>
      </div>
    </header>

    <div class="booster-reader-layout">
      <ArchiveConversationList
        :groups="sidebarGroups"
        :search="search"
        :selected-id="selectedId"
        :expanded-ids="expanded"
        :conversation-count="conversations.length"
        :loading="listLoading"
        :copy="sidebarCopy"
        @update:search="search = $event"
        @toggle="toggleGroup"
        @select="select"
      >
        <template #group-action="{ group }">
          <CopyIdentity v-if="group.id !== NONE" label="" :identifier="group.id" :locale="locale" />
        </template>
      </ArchiveConversationList>

      <main class="booster-reader-main">
        <div class="booster-reader-pinned">
          <button class="booster-mobile-back" type="button" @click="mobileList = true"><ArrowLeft class="size-4" />{{ t('reader.back') }}</button>
          <template v-if="selected">
            <header class="booster-reader-chat-header">
              <div>
                <h2><span v-if="selected.projectId" class="booster-reader-project-label">{{ projectLabel(selected.projectId) }} / </span><CopyIdentity :label="selected.title || t('identity.untitled')" :identifier="selected.conversationId" :locale="locale" /></h2>
                <p v-if="selected.branchSourceConversationId" class="booster-note">
                  <CopyIdentity :label="t('reader.branch') + ': ' + (selected.branchSourceTitle || t('identity.untitled'))" :identifier="selected.branchSourceConversationId" :locale="locale" />
                </p>
              </div>
            </header>
            <div class="booster-reader-chat-actions">
              <button class="booster-action-secondary" type="button" @click="reasoningExpanded = !reasoningExpanded"><Brain class="size-4" />{{ t(reasoningExpanded ? 'reader.collapseReasoning' : 'reader.expandReasoning') }}</button>
              <button class="booster-action-secondary booster-reader-export" type="button" :disabled="threadLoading" @click="emit('export', selected.conversationId, selected.title)"><Download class="size-4" />{{ t('reader.export') }}</button>
              <button class="booster-action-secondary booster-reader-history-toggle" type="button"
                :disabled="threadLoading || !navigationNodes.length" :aria-expanded="historyOpen"
                :aria-label="locale === 'ru' ? 'Показать историю сообщений' : 'Show message history'"
                :class="{ active: historyOpen }" @click="historyOpen = !historyOpen">
                <GitBranch class="size-4" />{{ locale === 'ru' ? 'История' : 'History' }}
              </button>
              <button v-if="forkChoices.length" class="booster-action-secondary booster-reader-fork-toggle" type="button" :aria-expanded="forksOpen" @click="forksOpen = !forksOpen"><GitBranch class="size-4" />{{ locale === 'ru' ? 'Ветки' : 'Forks' }} · {{ forkChoices.length }}</button>
              <button v-if="usingIndexedWindows && (hasOlderStored || unsequencedTarget)" type="button" class="booster-action-secondary" :disabled="threadLoading || loadingOlder" @click="returnToFirstKnown">{{ t('reader.firstKnown') }}</button>
              <button v-if="hasOlderStored" type="button" class="booster-action-secondary" :disabled="threadLoading || loadingOlder || staleSavedWindow" @click="loadAdjacent('older')">{{ t('reader.moreOlder') }}</button>
              <button v-if="hasNewerStored" type="button" class="booster-action-secondary" :disabled="threadLoading || loadingOlder || staleSavedWindow" @click="loadAdjacent('newer')">{{ t('reader.moreNewer') }}</button>
              <button v-if="hasNewerStored || unsequencedTarget" type="button" class="booster-action-secondary" :disabled="threadLoading || loadingOlder" @click="returnToLatest">{{ t('reader.returnLatest') }}</button>
              <button class="booster-action-secondary" type="button" :aria-expanded="searchOpen" :aria-label="t('reader.searchMessages')" @click="searchOpen = !searchOpen"><Search class="size-4" /></button>
            </div>
            <div v-if="forksOpen && forkChoices.length" class="booster-reader-fork-choices" :aria-label="locale === 'ru' ? 'Сохранённые варианты сообщений' : 'Saved message variants'">
              <div v-for="(fork, forkIndex) in forkChoices" :key="fork.id" class="booster-reader-fork-group">
                <span>{{ locale === 'ru' ? 'Развилка' : 'Fork' }} {{ forkIndex + 1 }}</span>
                <button v-for="(variant, variantIndex) in fork.variants" :key="variant.messageId" type="button" class="booster-reader-fork-choice"
                  :title="variant.text.slice(0, 160)"
                  @click="navigateToMessageKey(variant.key)">
                  {{ locale === 'ru' ? 'Вариант' : 'Variant' }} {{ variantIndex + 1 }} · {{ variant.text.slice(0, 45) }}
                </button>
              </div>
            </div>
            <div v-if="archiveAdapter.getMessageWindow" class="booster-reader-message-jump">
              <button type="button" class="booster-action-secondary" :aria-expanded="messageLookupOpen" @click="messageLookupOpen = !messageLookupOpen">{{ t('reader.jumpMessage') }}</button>
              <form v-if="messageLookupOpen" @submit.prevent="lookupMessage">
                <input v-model="messageLookup" type="text" maxlength="1024" :aria-label="t('reader.messageId')" :placeholder="t('reader.messageId')" />
                <button type="submit" class="booster-action-secondary" :disabled="threadLoading || !messageLookup.trim()">{{ t('reader.openMessage') }}</button>
              </form>
            </div>
            <div v-if="searchOpen" class="booster-reader-find">
              <input v-model="textSearch" type="search" :placeholder="t('reader.searchMessages')" :aria-label="t('reader.searchMessages')" />
              <p v-if="usingIndexedWindows && (hasOlderStored || hasNewerStored || knownStoredCount > thread.recordCount)" class="booster-note">{{ t('reader.windowSearchOnly') }}</p>
            </div>
            <p v-if="readSource === 'saved'" class="booster-note">{{ t('reader.savedInspection') }}</p>
            <p v-if="unsequencedTarget" class="booster-note">{{ t('reader.targetUnsequenced') }}</p>
            <div class="booster-reader-summary">
              <span>{{ t('dock.messages') }}: <b>{{ thread.messageCount }}</b> · {{ t('dock.details') }}: {{ thread.detailCount }}<template v-if="usingIndexedWindows"> · {{ locale === 'ru' ? 'Загружено' : 'Loaded' }} {{ thread.recordCount }}/{{ knownStoredCount }}</template></span>
              <span v-if="usingIndexedWindows && hasUnsequencedRecords" class="booster-reader-coverage">{{ locale === 'ru' ? 'Есть сообщения без подтверждённого времени' : 'Some messages have no confirmed chronology' }}</span>
              <span class="booster-reader-coverage" :title="t(archiveStatusKey)" :aria-label="t(archiveStatusKey)"><Info class="size-4" />{{ coverage?.completeAtLastRead ? (locale === 'ru' ? 'Цепочка подтверждена' : 'Path verified') : (locale === 'ru' ? 'Цепочка не подтверждена' : 'Path unverified') }}</span>
            </div>
          </template>
        </div>

        <p v-if="staleSavedWindow" role="alert" class="booster-error">
          {{ t('reader.staleWindow') }}
          <button type="button" class="booster-action-secondary" @click="retryLocation">{{ t('reader.reopenCurrentCopy') }}</button>
        </p>
        <p v-if="navigationError" role="alert" class="booster-error">{{ t(navigationError) }}</p>
        <p v-if="error" role="alert" class="booster-error">{{ t('reader.error') }}</p>
        <div class="booster-reader-reading-surface">
          <div v-if="loadingOlder" class="booster-reader-older-loading" role="status" aria-live="polite"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t(loadingDirection === 'newer' ? 'reader.loadingNewer' : 'reader.loadingEarlier') }} · {{ displayedTurns.length }}/{{ filteredTurns.length }}</div>
          <p v-if="historyOpen && usingIndexedWindows && (hasOlderStored || hasNewerStored || knownStoredCount > thread.recordCount)" class="booster-note">{{ t('reader.windowGraphOnly') }}</p>
          <ArchiveFlowGraph v-if="historyOpen && selected && navigationNodes.length && !threadLoading"
            :key="selectedId ?? ''" :thread="thread" :locale="locale" :active-key="activeMessageKey"
            @navigate="navigateToMessageKey" @close="historyOpen = false" />
          <div ref="readingScroll" class="booster-reader-scroll" @scroll.passive="onReadingScroll">
            <p v-if="threadLoading" role="status" class="booster-reader-loading"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t('reader.loading') }}<button type="button" class="booster-action-secondary" @click="cancelNavigation">{{ t('reader.cancelNavigation') }}</button></p>
            <template v-else-if="selected">
              <ArchiveTranscript :turns="transcript.turns" :is-empty="!filteredTurns.length"
                :target-message-id="requestedMessageId" :copy="transcriptCopy">
                <template #record="{record}">
                  <ArchiveRecord v-if="transcript.byKey.get(record.key)"
                    :item="transcript.byKey.get(record.key)!"
                    :locale="locale" :expand-reasoning="reasoningExpanded"
                    :focused="requestedMessageId===record.messageId"/>
                </template>
              </ArchiveTranscript>
            </template>
            <p v-else-if="!listLoading" class="booster-note">{{ t('reader.missing') }}</p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
