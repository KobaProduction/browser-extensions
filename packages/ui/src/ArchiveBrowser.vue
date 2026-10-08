<script setup lang="ts">
import { ARCHIVE_UPDATED_EVENT, type ArchiveThreadView } from '@chatgpt-booster/core'
import ArrowLeft from 'lucide-vue-next/dist/esm/icons/arrow-left.js'
import Search from 'lucide-vue-next/dist/esm/icons/search.js'
import Info from 'lucide-vue-next/dist/esm/icons/info.js'
import Brain from 'lucide-vue-next/dist/esm/icons/brain.js'
import ChevronDown from 'lucide-vue-next/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-vue-next/dist/esm/icons/chevron-right.js'
import Database from 'lucide-vue-next/dist/esm/icons/database.js'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import GitBranch from 'lucide-vue-next/dist/esm/icons/git-branch.js'
import GripHorizontal from 'lucide-vue-next/dist/esm/icons/grip-horizontal.js'
import LoaderCircle from 'lucide-vue-next/dist/esm/icons/loader-circle.js'
import Minus from 'lucide-vue-next/dist/esm/icons/minus.js'
import RefreshCw from 'lucide-vue-next/dist/esm/icons/refresh-cw.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveRecord from './ArchiveRecord.vue'
import {
  archiveConversationForest,
  archiveNavigatorSample,
  archiveNavigatorEdges,
  archiveTimelinePosition,
  archiveTurnWindow,
  ARCHIVE_INITIAL_TURNS,
  ARCHIVE_TURN_BATCH,
  type ArchiveReadingOrder,
} from './archive-navigation'
import CopyIdentity from './CopyIdentity.vue'
import { archiveMessageGraph } from './archive-message-graph'
import { archiveForkChoices } from './archive-fork-choices'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type {
  ArchiveConversationView,
  ArchiveProjectView,
  ArchiveCoverageView,
  ArchiveDataAdapter,
} from './mount'

const props = defineProps<{
  archiveAdapter: ArchiveDataAdapter
  initialConversationId?: string | null | undefined
  locale: SupportedLocale
  windowed?: boolean
  openPosition?: 'first' | 'latest'
}>()
const emit = defineEmits<{
  close: []
  minimize: []
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
const mobileList = ref(!props.initialConversationId)
const search = ref('')
const textSearch = ref('')
const visibleCount = ref(ARCHIVE_INITIAL_TURNS)
const readingOrder = ref<ArchiveReadingOrder>('chronological')
const searchOpen = ref(false)
const forksOpen = ref(false)
const readingProgress = ref(1)
const windowCenter = ref<number | null>(null)
const loadingOlder = ref(false)
const readingScroll = ref<HTMLElement | null>(null)
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
  conversations.value.find((conversation) => conversation.conversationId === selectedId.value),
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
    return filteredTurns.value.slice(Math.max(0, offset - 20), Math.min(filteredTurns.value.length, offset + 20))
  }
  return archiveTurnWindow(filteredTurns.value, visibleCount.value, readingOrder.value)
})
const messageGraph = computed(() => archiveMessageGraph(thread.value))
const forkChoices = computed(() => archiveForkChoices(thread.value))
const navigationNodes = computed(() => thread.value.turns.flatMap(turn => turn.messages.filter(item => item.kind === 'user' || item.kind === 'answer')))
const timelineNodes = computed(() =>
  archiveNavigatorSample(
    navigationNodes.value,
    item => (messageGraph.value.get(item.record.messageKey)?.siblingCount ?? 1) > 1,
    36,
  ),
)
const navigatorEdges = computed(() => {
  const parents = new Map<string, string | null>()
  for (const turn of thread.value.turns)
    for (const item of [...turn.messages, ...turn.details])
      if (item.record.messageId) parents.set(item.record.messageId, item.record.parentId)
  return archiveNavigatorEdges(parents, timelineNodes.value.map(({ item, index }) => ({
    id: item.record.messageId, index,
  })))
})
function nodeAxisX(index: number): number {
  const item = navigationNodes.value[index]
  return 18 + Math.min(3, item ? (messageGraph.value.get(item.record.messageKey)?.lane ?? 0) : 0) * 23
}
function graphEdgePath(from: number, to: number): string {
  const startY = archiveTimelinePosition((from + 0.5) / Math.max(1, navigationNodes.value.length), readingProgress.value) * 1000
  const endY = archiveTimelinePosition((to + 0.5) / Math.max(1, navigationNodes.value.length), readingProgress.value) * 1000
  const startX = nodeAxisX(from), endX = nodeAxisX(to)
  const bendY = startY + (endY - startY) * 0.25
  return `M ${startX} ${startY} L ${startX} ${bendY} Q ${startX} ${endY} ${endX} ${endY}`
}
const currentNavigationIndex = computed(() => Math.round(readingProgress.value * Math.max(0, navigationNodes.value.length - 1)))
const hasEarlier = computed(() => filteredTurns.value.length > visibleCount.value)
const archiveStatusKey = computed<TranslationKey>(() =>
  coverage.value?.completeAtLastRead ? 'reader.savedToStart' : 'reader.savedPartial',
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
async function resetReadingPosition() {
  const ticket = ++scrollRevision
  resettingPosition = true
  visibleCount.value = ARCHIVE_INITIAL_TURNS
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
  if (props.openPosition === 'first' && filteredTurns.value.length) {
    windowCenter.value = 0
    await nextTick()
    if (!alive || scrollRevision !== ticket) return
    viewport.scrollTop = 0
    readingProgress.value = 0
  } else {
    viewport.scrollTop = readingOrder.value === 'chronological' ? viewport.scrollHeight : 0
    readingProgress.value = readingOrder.value === 'chronological' ? 1 : 0
  }
  resettingPosition = false
}

async function loadEarlier() {
  const viewport = readingScroll.value
  if (!viewport || loadingOlder.value || threadLoading.value || !hasEarlier.value) return
  const ticket = scrollRevision
  const conversation = selectedId.value
  const beforeHeight = viewport.scrollHeight
  const beforeTop = viewport.scrollTop
  loadingOlder.value = true
  // Let the pending state paint before expensive exchange layout work.
  await paintLoadingStatus()
  if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
  visibleCount.value = Math.min(
    filteredTurns.value.length,
    visibleCount.value + ARCHIVE_TURN_BATCH,
  )
  await nextTick()
  if (!alive || ticket !== scrollRevision || selectedId.value !== conversation) return
  if (readingOrder.value === 'chronological')
    viewport.scrollTop = beforeTop + viewport.scrollHeight - beforeHeight
  else viewport.scrollTop = beforeTop
  loadingOlder.value = false
}

function onReadingScroll() {
  const viewport = readingScroll.value
  if (!viewport || resettingPosition) return
  const fraction = viewport.scrollTop / Math.max(1, viewport.scrollHeight - viewport.clientHeight)
  const total = filteredTurns.value.length
  const start = windowCenter.value !== null
    ? Math.max(0, windowCenter.value - 20)
    : Math.max(0, total - visibleCount.value)
  readingProgress.value = Math.max(0, Math.min(1, (start + fraction * displayedTurns.value.length) / Math.max(1, total)))
  if (windowCenter.value !== null) {
    if (loadingOlder.value) return
    const atTop = viewport.scrollTop < 100
    const atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 100
    if (atTop && windowCenter.value > 0) void shiftWindow(-20)
    else if (atBottom && windowCenter.value < filteredTurns.value.length - 1) void shiftWindow(20)
    return
  }
  if (!hasEarlier.value || loadingOlder.value) return
  const reachedOlderEdge =
    readingOrder.value === 'chronological'
      ? viewport.scrollTop < 180
      : viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 180
  if (reachedOlderEdge) void loadEarlier()
}

async function paintLoadingStatus() {
  await nextTick()
  // Background tabs can suspend animation frames indefinitely; never gate reads on them.
  if (document.hidden) return
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
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
watch([textSearch, readingOrder], () => { if (!suppressSearchReset) void resetReadingPosition() })

watch(
  () => props.initialConversationId,
  (next) => {
    if (!next || next === selectedId.value) return
    selectedId.value = next
    textSearch.value = ''
    mobileList.value = false
    void loadThread(next)
  },
)


async function loadThread(id: string | null) {
  const revision = ++threadRevision
  ++scrollRevision
  ++windowShiftRevision
  resettingPosition = false
  thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }
  coverage.value = undefined
  visibleCount.value = ARCHIVE_INITIAL_TURNS
  windowCenter.value = null
  loadingOlder.value = false
  if (!id) {
    threadLoading.value = false
    return
  }
  threadLoading.value = true
  error.value = false
  try {
    await paintLoadingStatus()
    if (!alive || revision !== threadRevision || selectedId.value !== id) return
    const [next, nextCoverage] = await Promise.all([
      props.archiveAdapter.getThread(id),
      props.archiveAdapter.getCoverage(id),
    ])
    if (!alive || revision !== threadRevision || selectedId.value !== id) return
    thread.value = next
    coverage.value = nextCoverage
    threadLoading.value = false
    await resetReadingPosition()
  } catch {
    if (alive && revision === threadRevision) error.value = true
  } finally {
    if (alive && revision === threadRevision) threadLoading.value = false
  }
}
function select(id: string) {
  ++windowShiftRevision
  selectedId.value = id
  mobileList.value = false
  textSearch.value = ''
  forksOpen.value = false
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
      if (!selectedId.value) selectedId.value = cs[0]?.conversationId ?? null
      const projectId =
        cs.find((c) => c.conversationId === selectedId.value)?.projectId ??
        props.archiveAdapter.currentProjectId()
      expanded.value = new Set([projectId ?? NONE])
      initialized = true
    }
    await loadThread(selectedId.value)
  } catch {
    if (alive && revision === listRevision) error.value = true
  } finally {
    if (alive && revision === listRevision) listLoading.value = false
  }
}
async function refreshConversationTitles() {
  try {
    const items = await props.archiveAdapter.listConversations()
    if (alive) conversations.value = items
  } catch {
    // The current reader stays usable when catalog refresh fails.
  }
}
onMounted(async () => {
  // Capture the live context before the asynchronous archive read. Navigation
  // during the initial read must not silently become the observer baseline.
  let current = props.archiveAdapter.currentConversationId()
  const syncContext = () => {
    const next = props.archiveAdapter.currentConversationId()
    if (!next || next === current) return
    current = next
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
  listRevision++
  threadRevision++
  scrollRevision++
  windowShiftRevision++
  contextUnsubscribe?.()
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, refreshConversationTitles)
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
        <button type="button" class="booster-icon-button" :disabled="listLoading" :title="t('reader.refresh')" :aria-label="t('reader.refresh')" @click="refresh"><RefreshCw class="size-4" /></button>
        <button v-if="windowed" type="button" class="booster-icon-button" :title="t('reader.minimize')" :aria-label="t('reader.minimize')" @click="emit('minimize')"><Minus class="size-4" /></button>
        <button type="button" class="booster-icon-button" :aria-label="t('reader.close')" @click="emit('close')"><X class="size-4" /></button>
      </div>
    </header>

    <div class="booster-reader-layout">
      <aside class="booster-reader-sidebar">
        <input v-model="search" type="search" :aria-label="t('reader.search')" :placeholder="t('reader.search')" />
        <p v-if="listLoading && !conversations.length" role="status" class="booster-note">{{ t('reader.loading') }}</p>
        <p v-else-if="!conversations.length" class="booster-note">{{ t('reader.empty') }}</p>
        <p v-else-if="!groups.length" class="booster-note">{{ t('reader.noResults') }}</p>
        <section v-for="group in groups" :key="group.id" class="booster-reader-group">
          <div class="booster-reader-group-header">
            <button class="booster-group-toggle" type="button" :aria-expanded="expanded.has(group.id) || !!search.trim()" @click="toggleGroup(group.id)">
              <ChevronDown v-if="expanded.has(group.id) || search.trim()" class="size-4" />
              <ChevronRight v-else class="size-4" />
              <span>{{ group.label }}</span><small>{{ group.count }}</small>
            </button>
            <CopyIdentity v-if="group.id !== NONE" label="" :identifier="group.id" :locale="locale" />
          </div>
          <div v-if="expanded.has(group.id) || search.trim()" class="booster-reader-chat-list">
            <button
              v-for="entry in group.rows"
              :key="entry.conversation.conversationId"
              type="button"
              :class="{ active: selectedId === entry.conversation.conversationId, 'is-branch': entry.branched }"
              :style="{ paddingInlineStart: (10 + Math.min(entry.depth, 12) * 14) + 'px' }"
              :title="entry.sourceMissing ? t('reader.branchMissing') : entry.conversation.title || t('identity.untitled')"
              @click="select(entry.conversation.conversationId)"
            >
              <GitBranch v-if="entry.branched" class="booster-reader-branch-icon size-3.5" />
              <span>{{ entry.conversation.title || t('identity.untitled') }}</span>
            </button>
          </div>
        </section>
      </aside>

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
              <button v-if="forkChoices.length" class="booster-action-secondary booster-reader-fork-toggle" type="button" :aria-expanded="forksOpen" @click="forksOpen = !forksOpen"><GitBranch class="size-4" />{{ locale === 'ru' ? 'Ветки' : 'Forks' }} · {{ forkChoices.length }}</button>
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
            <div v-if="searchOpen" class="booster-reader-find">
              <input v-model="textSearch" type="search" :placeholder="t('reader.searchMessages')" :aria-label="t('reader.searchMessages')" />
            </div>
            <div class="booster-reader-summary">
              <span>{{ t('dock.messages') }}: <b>{{ thread.messageCount }}</b> · {{ t('dock.details') }}: {{ thread.detailCount }}</span>
              <span class="booster-reader-coverage" :title="t(archiveStatusKey)" :aria-label="t(archiveStatusKey)"><Info class="size-4" />{{ coverage?.completeAtLastRead ? (locale === 'ru' ? 'Начало подтверждено' : 'Start verified') : (locale === 'ru' ? 'Начало не подтверждено' : 'Start unverified') }}</span>
            </div>
          </template>
        </div>

        <p v-if="error" role="alert" class="booster-error">{{ t('reader.error') }}</p>
        <div class="booster-reader-reading-surface">
          <div v-if="loadingOlder" class="booster-reader-older-loading" role="status" aria-live="polite"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t('reader.loadingEarlier') }} · {{ displayedTurns.length }}/{{ filteredTurns.length }}</div>
          <nav v-if="selected && navigationNodes.length" class="booster-reader-map" :aria-label="locale === 'ru' ? 'Навигация по сообщениям' : 'Message timeline'">
            <button class="booster-reader-map-end" type="button" :title="locale === 'ru' ? 'Начало сохранённых сообщений' : 'First saved message'" @click="navigateToNode(0)">↑</button>
            <div class="booster-reader-map-track">
              <svg class="booster-reader-map-links" viewBox="0 0 108 1000" preserveAspectRatio="none" aria-hidden="true">
                <path v-for="edge in navigatorEdges" :key="`${edge.from}-${edge.to}`" :d="graphEdgePath(edge.from, edge.to)" />
              </svg>
              <button v-for="{ item, index } in timelineNodes" :key="item.record.messageKey" class="booster-reader-map-node"
                :class="{ 'is-user': item.kind === 'user', 'is-fork': (messageGraph.get(item.record.messageKey)?.siblingCount ?? 1) > 1, 'is-near': Math.abs(index - currentNavigationIndex) < 3 }"
                :style="{ top: `${archiveTimelinePosition((index + 0.5) / navigationNodes.length, readingProgress) * 100}%`, '--map-lane': messageGraph.get(item.record.messageKey)?.lane ?? 0 }"
                :title="`${item.kind === 'user' ? (locale === 'ru' ? 'Вы' : 'You') : (locale === 'ru' ? 'Ассистент' : 'Assistant')} · ${item.record.createTime ? date(item.record.createTime * 1000) : ''}
${item.text.slice(0, 160)}`"
                :data-preview="(item.record.createTime ? date(item.record.createTime * 1000) + ' · ' : '') + item.text.slice(0, 145)"
                :aria-label="item.text.slice(0, 80)" type="button" @click="navigateToNode(index)"></button>
              <span class="booster-reader-map-position" :style="{ top: `${readingProgress * 100}%` }"></span>
            </div>
            <button class="booster-reader-map-end" type="button" :title="locale === 'ru' ? 'Последние сообщения' : 'Last messages'" @click="navigateToNode(navigationNodes.length - 1)">↓</button>
          </nav>
          <div ref="readingScroll" class="booster-reader-scroll" @scroll.passive="onReadingScroll">
            <p v-if="threadLoading" role="status" class="booster-reader-loading"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t('reader.loading') }}</p>
            <template v-else-if="selected">
              <div class="booster-reader-exchanges">
                <p v-if="!filteredTurns.length" class="booster-note">{{ t('reader.noResults') }}</p>
                <article v-for="turn in displayedTurns" :key="turn.id" class="booster-exchange">
                  <p v-if="turn.association === 'unassigned'" class="booster-note">{{ t('reader.unassigned') }}</p>
                  <p v-else-if="turn.association === 'adjacency'" class="booster-note">{{ t('reader.adjacency') }}</p>
                  <div v-for="item in turn.messages.filter(i => i.kind === 'user')" :key="item.record.messageKey" :data-archive-node="item.record.messageKey"><ArchiveRecord :item="item" :locale="locale" :expand-reasoning="reasoningExpanded" /></div>
                  <div v-if="turn.details.length" class="booster-exchange-details">
                    <div class="booster-exchange-details-label">{{ t('reader.details') }} · {{ turn.details.length }}</div>
                    <ArchiveRecord v-for="item in turn.details" :key="item.record.messageKey" :item="item" :locale="locale" :expand-reasoning="reasoningExpanded" />
                  </div>
                  <div v-for="item in turn.messages.filter(i => i.kind !== 'user')" :key="item.record.messageKey" :data-archive-node="item.record.messageKey"><ArchiveRecord :item="item" :locale="locale" :expand-reasoning="reasoningExpanded" /></div>
                </article>
              </div>
            </template>
            <p v-else-if="!listLoading" class="booster-note">{{ t('reader.missing') }}</p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
