<script setup lang="ts">
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import ArrowLeft from 'lucide-vue-next/dist/esm/icons/arrow-left.js'
import ArrowDownUp from 'lucide-vue-next/dist/esm/icons/arrow-down-up.js'
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
  archiveTurnWindow,
  ARCHIVE_INITIAL_TURNS,
  ARCHIVE_TURN_BATCH,
  type ArchiveReadingOrder,
} from './archive-navigation'
import CopyIdentity from './CopyIdentity.vue'
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
const loadingOlder = ref(false)
const readingScroll = ref<HTMLElement | null>(null)
const expanded = ref(new Set<string>())
const reasoningExpanded = ref(false)
let alive = true
let listRevision = 0
let threadRevision = 0
let scrollRevision = 0
let initialized = false
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
const displayedTurns = computed(() =>
  archiveTurnWindow(filteredTurns.value, visibleCount.value, readingOrder.value),
)
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
  visibleCount.value = ARCHIVE_INITIAL_TURNS
  loadingOlder.value = false
  await nextTick()
  if (!alive || scrollRevision !== ticket) return
  const viewport = readingScroll.value
  if (!viewport) return

  // Short messages may not fill a tall reading pane; add enough older turns to scroll.
  for (
    let batch = 0;
    batch < 8 && hasEarlier.value && viewport.scrollHeight <= viewport.clientHeight + 8;
    batch++
  ) {
    visibleCount.value += ARCHIVE_TURN_BATCH
    await nextTick()
    if (!alive || scrollRevision !== ticket) return
  }
  viewport.scrollTop = readingOrder.value === 'chronological' ? viewport.scrollHeight : 0
}

async function loadEarlier() {
  const viewport = readingScroll.value
  if (!viewport || loadingOlder.value || threadLoading.value || !hasEarlier.value) return
  const ticket = scrollRevision
  const conversation = selectedId.value
  const beforeHeight = viewport.scrollHeight
  const beforeTop = viewport.scrollTop
  loadingOlder.value = true
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
  if (!viewport || !hasEarlier.value || loadingOlder.value) return
  const reachedOlderEdge =
    readingOrder.value === 'chronological'
      ? viewport.scrollTop < 180
      : viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 180
  if (reachedOlderEdge) void loadEarlier()
}

watch([textSearch, readingOrder], () => { void resetReadingPosition() })

async function loadThread(id: string | null) {
  const revision = ++threadRevision
  ++scrollRevision
  thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }
  coverage.value = undefined
  visibleCount.value = ARCHIVE_INITIAL_TURNS
  loadingOlder.value = false
  if (!id) {
    threadLoading.value = false
    return
  }
  threadLoading.value = true
  error.value = false
  try {
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
  selectedId.value = id
  mobileList.value = false
  textSearch.value = ''
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
onMounted(async () => {
  await refresh()
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
  if (props.archiveAdapter.subscribeContextChange)
    contextUnsubscribe = props.archiveAdapter.subscribeContextChange(syncContext)
  else contextFallbackTimer = setInterval(syncContext, 450)
})
onBeforeUnmount(() => {
  alive = false
  listRevision++
  threadRevision++
  scrollRevision++
  contextUnsubscribe?.()
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
                <h2><CopyIdentity :label="selected.title || t('identity.untitled')" :identifier="selected.conversationId" :locale="locale" /></h2>
                <CopyIdentity :label="projectLabel(selected.projectId)" :identifier="selected.projectId" :locale="locale" />
                <p v-if="selected.branchSourceConversationId" class="booster-note">
                  <CopyIdentity :label="t('reader.branch') + ': ' + (selected.branchSourceTitle || t('identity.untitled'))" :identifier="selected.branchSourceConversationId" :locale="locale" />
                </p>
              </div>
            </header>
            <div class="booster-reader-chat-actions">
              <button class="booster-action-secondary" type="button" @click="reasoningExpanded = !reasoningExpanded"><Brain class="size-4" />{{ t(reasoningExpanded ? 'reader.collapseReasoning' : 'reader.expandReasoning') }}</button>
              <button class="booster-action-secondary booster-reader-export" type="button" :disabled="threadLoading" @click="emit('export', selected.conversationId, selected.title)"><Download class="size-4" />{{ t('reader.export') }}</button>
              <button class="booster-action-secondary" type="button" :aria-pressed="readingOrder === 'newest-first'" @click="readingOrder = readingOrder === 'chronological' ? 'newest-first' : 'chronological'"><ArrowDownUp class="size-4" />{{ t(readingOrder === 'chronological' ? 'reader.newestFirst' : 'reader.chronological') }}</button>
            </div>
            <div class="booster-reader-find">
              <input v-model="textSearch" type="search" :placeholder="t('reader.searchMessages')" :aria-label="t('reader.searchMessages')" />
            </div>
            <div class="booster-reader-summary">
              <span>{{ t('dock.messages') }}: <b>{{ thread.messageCount }}</b></span>
              <span>{{ t('dock.details') }}: {{ thread.detailCount }}</span>
              <span>{{ t(archiveStatusKey) }}</span>
              <p v-if="coverage?.currentLastMessageId">{{ t(coverage.storedLatestMatchesCurrent ? 'reader.currentLatestSaved' : 'reader.currentNewer') }}</p>
              <p v-if="coverage?.verifiedAt">{{ t('reader.lastRefreshCheck') }}: {{ date(coverage.verifiedAt) }}</p>
              <p v-else>{{ t('reader.updateUnchecked') }}</p>
            </div>
          </template>
        </div>

        <p v-if="error" role="alert" class="booster-error">{{ t('reader.error') }}</p>
        <div class="booster-reader-reading-surface">
          <div v-if="loadingOlder" class="booster-reader-older-loading" role="status"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t('reader.loadingEarlier') }}</div>
          <div ref="readingScroll" class="booster-reader-scroll" @scroll.passive="onReadingScroll">
            <p v-if="threadLoading" role="status" class="booster-reader-loading"><LoaderCircle class="size-4 booster-reader-spinner" />{{ t('reader.loading') }}</p>
            <template v-else-if="selected">
              <div class="booster-reader-exchanges">
                <p v-if="!filteredTurns.length" class="booster-note">{{ t('reader.noResults') }}</p>
                <article v-for="turn in displayedTurns" :key="turn.id" class="booster-exchange">
                  <p v-if="turn.association === 'unassigned'" class="booster-note">{{ t('reader.unassigned') }}</p>
                  <p v-else-if="turn.association === 'adjacency'" class="booster-note">{{ t('reader.adjacency') }}</p>
                  <ArchiveRecord v-for="item in turn.messages.filter(i => i.kind === 'user')" :key="item.record.messageKey" :item="item" :locale="locale" :expand-reasoning="reasoningExpanded" />
                  <div v-if="turn.details.length" class="booster-exchange-details">
                    <div class="booster-exchange-details-label">{{ t('reader.details') }} · {{ turn.details.length }}</div>
                    <ArchiveRecord v-for="item in turn.details" :key="item.record.messageKey" :item="item" :locale="locale" :expand-reasoning="reasoningExpanded" />
                  </div>
                  <ArchiveRecord v-for="item in turn.messages.filter(i => i.kind !== 'user')" :key="item.record.messageKey" :item="item" :locale="locale" :expand-reasoning="reasoningExpanded" />
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
