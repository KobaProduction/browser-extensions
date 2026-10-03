<script setup lang="ts">
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import { ChevronDown, ChevronRight, Database, Download, RefreshCw, X, ArrowLeft } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveRecord from './ArchiveRecord.vue'
import CopyIdentity from './CopyIdentity.vue'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type { ArchiveConversationView, ArchiveProjectView, ArchiveCoverageView, ArchiveDataAdapter } from './mount'
const props = defineProps<{ archiveAdapter: ArchiveDataAdapter; initialConversationId?: string | null; locale: SupportedLocale }>()
const emit = defineEmits<{ close: []; export: [conversationId: string, title: string | null] }>()
const t = (key: TranslationKey) => translate(props.locale, key)
const conversations = ref<ArchiveConversationView[]>([]), projects = ref<ArchiveProjectView[]>([])
const selectedId = ref<string | null>(props.initialConversationId ?? null)
const thread = ref<ArchiveThreadView>({ turns: [], messageCount: 0, recordCount: 0, detailCount: 0 })
const coverage = ref<ArchiveCoverageView>()
const listLoading = ref(false), threadLoading = ref(false), error = ref(false), mobileList = ref(!props.initialConversationId)
const search = ref(''), textSearch = ref(''), visibleCount = ref(40), expanded = ref(new Set<string>()), details = ref(new Set<string>())
let alive = true, listRevision = 0, threadRevision = 0, initialized = false
const NONE = '__outside_projects__'
const selected = computed(() => conversations.value.find(c => c.conversationId === selectedId.value))
const projectLabel = (id: string | null) => id ? projects.value.find(p => p.projectId === id)?.title || t('identity.unknownProject') : t('reader.noProject')
const groups = computed(() => {
  const q = search.value.trim().toLocaleLowerCase()
  const groups = new Map<string, ArchiveConversationView[]>()
  for (const c of conversations.value) {
    if (q && !`${c.title ?? ''} ${projectLabel(c.projectId)}`.toLocaleLowerCase().includes(q)) continue
    const id = c.projectId ?? NONE
    const list = groups.get(id) ?? []; list.push(c); groups.set(id, list)
  }
  return [...groups].map(([id, items]) => ({ id, items, label: projectLabel(id === NONE ? null : id) }))
})
const filteredTurns = computed(() => {
  const q = textSearch.value.trim().toLocaleLowerCase()
  return q ? thread.value.turns.filter(turn => [...turn.messages, ...turn.details].some(item => `${item.text} ${item.record.recipient ?? ''}`.toLocaleLowerCase().includes(q))) : thread.value.turns
})
const coverageText = computed(() => !coverage.value ? 'dock.none' : coverage.value.evidenceVersion !== 1 ? 'dock.unverified' : coverage.value.completeAtLastRead ? 'dock.verified' : 'dock.partial')
watch(textSearch, () => { visibleCount.value = 40 })
function toggleGroup(id: string) { const next = new Set(expanded.value); if (!next.delete(id)) next.add(id); expanded.value = next }
function toggleDetails(event: Event, id: string) { const next = new Set(details.value); if ((event.target as HTMLDetailsElement).open) next.add(id); else next.delete(id); details.value = next }
function date(value?: number | null) { return value ? new Date(value).toLocaleString(props.locale) : '' }
async function loadThread(id: string | null) {
  const revision = ++threadRevision
  thread.value = { turns: [], messageCount: 0, recordCount: 0, detailCount: 0 }; coverage.value = undefined; details.value = new Set(); visibleCount.value = 40
  if (!id) { threadLoading.value = false; return }
  threadLoading.value = true; error.value = false
  try {
    const [next, nextCoverage] = await Promise.all([props.archiveAdapter.getThread(id), props.archiveAdapter.getCoverage(id)])
    if (!alive || revision !== threadRevision || selectedId.value !== id) return
    thread.value = next; coverage.value = nextCoverage
  } catch { if (alive && revision === threadRevision) error.value = true }
  finally { if (alive && revision === threadRevision) threadLoading.value = false }
}
function select(id: string) { selectedId.value = id; mobileList.value = false; textSearch.value = ''; void loadThread(id) }
async function refresh() {
  const revision = ++listRevision
  listLoading.value = true; error.value = false
  try {
    const [cs, ps] = await Promise.all([props.archiveAdapter.listConversations(), props.archiveAdapter.listProjects()])
    if (!alive || revision !== listRevision) return
    conversations.value = cs; projects.value = ps
    if (!initialized) {
      if (!selectedId.value) selectedId.value = cs[0]?.conversationId ?? null
      const projectId = cs.find(c => c.conversationId === selectedId.value)?.projectId ?? props.archiveAdapter.currentProjectId()
      expanded.value = new Set([projectId ?? NONE]); initialized = true
    }
    await loadThread(selectedId.value)
  } catch { if (alive && revision === listRevision) error.value = true }
  finally { if (alive && revision === listRevision) listLoading.value = false }
}
onMounted(refresh)
onBeforeUnmount(() => { alive = false; listRevision++; threadRevision++ })
</script>
<template>
  <div class="booster-reader" :lang="locale" :class="{ 'booster-reader-list-mode': mobileList }">
    <header class="booster-section-header"><div class="booster-reader-heading"><Database class="size-5" /><div><strong>{{ t('reader.title') }}</strong><p>{{ t('reader.readonly') }}</p></div></div><div class="booster-header-actions"><button type="button" class="booster-icon-button" :disabled="listLoading" :title="t('reader.refresh')" :aria-label="t('reader.refresh')" @click="refresh"><RefreshCw class="size-4" /></button><button type="button" class="booster-icon-button" :aria-label="t('reader.close')" @click="emit('close')"><X class="size-4" /></button></div></header>
    <div class="booster-reader-layout">
      <aside class="booster-reader-sidebar">
        <input v-model="search" type="search" :aria-label="t('reader.search')" :placeholder="t('reader.search')" />
        <p v-if="listLoading && !conversations.length" role="status" class="booster-note">{{ t('reader.loading') }}</p>
        <p v-else-if="!conversations.length" class="booster-note">{{ t('reader.empty') }}</p>
        <p v-else-if="!groups.length" class="booster-note">{{ t('reader.noResults') }}</p>
        <section v-for="group in groups" :key="group.id" class="booster-reader-group">
          <div class="booster-reader-group-header"><button class="booster-group-toggle" type="button" :aria-expanded="expanded.has(group.id) || !!search.trim()" @click="toggleGroup(group.id)"><ChevronDown v-if="expanded.has(group.id) || search.trim()" class="size-4" /><ChevronRight v-else class="size-4" /><span>{{ group.label }}</span><small>{{ group.items.length }}</small></button><CopyIdentity v-if="group.id !== NONE" label="" :identifier="group.id" :locale="locale" /></div>
          <div v-if="expanded.has(group.id) || search.trim()" class="booster-reader-chat-list"><button v-for="c in group.items" :key="c.conversationId" type="button" :class="{ active: selectedId === c.conversationId }" @click="select(c.conversationId)">{{ c.title || t('identity.untitled') }}</button></div>
        </section>
      </aside>
      <main class="booster-reader-main">
        <button class="booster-mobile-back" type="button" @click="mobileList = true"><ArrowLeft class="size-4" />{{ t('reader.back') }}</button>
        <p v-if="error" class="booster-error" role="alert">{{ t('reader.error') }}</p>
        <template v-if="selected">
          <header class="booster-reader-chat-header"><div><h2><CopyIdentity :label="selected.title || t('identity.untitled')" :identifier="selected.conversationId" :locale="locale" /></h2><CopyIdentity :label="projectLabel(selected.projectId)" :identifier="selected.projectId" :locale="locale" /><p v-if="selected.branchSourceConversationId" class="booster-note"><CopyIdentity :label="t('reader.branch') + ': ' + (selected.branchSourceTitle || t('identity.untitled'))" :identifier="selected.branchSourceConversationId" :locale="locale" /></p></div><button class="booster-action-secondary" type="button" :disabled="threadLoading" @click="emit('export', selected.conversationId, selected.title)"><Download class="size-4" />{{ t('reader.export') }}</button></header>
          <div class="booster-reader-summary"><span>{{ t('dock.messages') }}: <b>{{ thread.messageCount }}</b></span><span>{{ t('dock.details') }}: {{ thread.detailCount }}</span><span>{{ t(coverageText) }}<template v-if="coverage?.verifiedAt"> · {{ date(coverage.verifiedAt) }}</template></span><p>{{ t('dock.coverageNote') }}</p></div>
          <input v-model="textSearch" class="booster-reader-text-search" type="search" :placeholder="t('reader.searchMessages')" :aria-label="t('reader.searchMessages')" />
          <p v-if="threadLoading" class="booster-note" role="status">{{ t('reader.loading') }}</p>
          <div v-else class="booster-reader-exchanges">
            <p v-if="!filteredTurns.length" class="booster-note">{{ t('reader.noResults') }}</p>
            <article v-for="turn in filteredTurns.slice(0, visibleCount)" :key="turn.id" class="booster-exchange">
              <p v-if="turn.association === 'unassigned'" class="booster-note">{{ t('reader.unassigned') }}</p><p v-else-if="turn.association === 'adjacency'" class="booster-note">{{ t('reader.adjacency') }}</p>
              <ArchiveRecord v-for="item in turn.messages.filter(i => i.kind === 'user')" :key="item.record.messageKey" :item="item" :locale="locale" />
              <details v-if="turn.details.length" class="booster-exchange-details" @toggle="toggleDetails($event, turn.id)"><summary>{{ t('reader.details') }} · {{ turn.details.length }}</summary><div v-if="details.has(turn.id)"><ArchiveRecord v-for="item in turn.details" :key="item.record.messageKey" :item="item" :locale="locale" /></div></details>
              <ArchiveRecord v-for="item in turn.messages.filter(i => i.kind !== 'user')" :key="item.record.messageKey" :item="item" :locale="locale" />
            </article>
            <button v-if="visibleCount < filteredTurns.length" class="booster-action-secondary" type="button" @click="visibleCount += 40">{{ t('reader.more') }}</button>
          </div>
        </template><p v-else-if="!listLoading" class="booster-note">{{ t('reader.missing') }}</p>
      </main>
    </div>
  </div>
</template>
