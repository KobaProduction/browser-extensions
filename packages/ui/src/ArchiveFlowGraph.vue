<script setup lang="ts">
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import { createGitgraph, Mode, Orientation, TemplateName, templateExtend } from '@gitgraph/js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { archiveGitgraphData, archiveGitgraphSegments } from './archive-gitgraph'

const PAGE_SIZE = 140
const props = defineProps<{ thread: ArchiveThreadView; locale: 'ru' | 'en'; activeKey?: string | null }>()
const emit = defineEmits<{ navigate: [key: string]; close: [] }>()
const holder = ref<HTMLElement | null>(null)
const scrollPane = ref<HTMLElement | null>(null)
const data = computed(() => archiveGitgraphData(props.thread))
const ordered = computed(() => [...data.value.commits].reverse())
const pageStart = ref(Math.max(0, ordered.value.length - PAGE_SIZE))
const pageEnd = computed(() => Math.min(ordered.value.length, pageStart.value + PAGE_SIZE))
const segments = computed(() => archiveGitgraphSegments(ordered.value.slice(pageStart.value, pageEnd.value).reverse()))
const linkedEdges = computed(() => data.value.commits.filter((commit) => commit.parents.length > 0).length)
// Sparse data is not a Git-shaped history. Showing dozens of isolated colored
// SVG stems implies branching that was never observed in the archive.
const sparseHistory = computed(() =>
  ordered.value.length > 4 &&
  (linkedEdges.value < ordered.value.length * 0.55 ||
    segments.value.length > Math.max(3, ordered.value.length * 0.45)),
)
// Graph import is topologically sorted, but an unlinked history must preserve
// the archive's actual turn order instead of grouping all roots before replies.
const chronologicalItems = computed(() => {
  const byCommit = new Map(data.value.commits.map((commit) => [commit.hash, commit]))
  const seen = new Set<string>()
  const items = []
  for (const turn of props.thread.turns) {
    for (const message of turn.messages) {
      const id = message.record.messageId
      const commit = byCommit.get(id)
      if (!commit || seen.has(id)) continue
      seen.add(id)
      items.push(commit)
    }
  }
  return items
})
const displayItems = computed(() => sparseHistory.value ? chronologicalItems.value : ordered.value)
const pageItems = computed(() => displayItems.value.slice(pageStart.value, pageEnd.value))
const messageText = (id: string) => (data.value.byId.get(id)?.text ?? '').replace(/\s+/g, ' ').trim()
const isUser = (id: string) => data.value.byId.get(id)?.kind === 'user'
const messageKey = (id: string) => data.value.byId.get(id)?.record.messageKey ?? id
const messageLabel = (id: string) => isUser(id)
  ? (props.locale === 'ru' ? 'Вы' : 'You')
  : (props.locale === 'ru' ? 'Ассистент' : 'Assistant')

let disposed = false
let graphObserver: MutationObserver | null = null
let decorationFrame: number | null = null
let shouldRevealSelection = false

/** GitGraph re-creates its SVG dot groups during its own MutationObserver
 * render cycle. Reapply interaction metadata after any child-list replacement;
 * attribute-only decoration cannot trigger this observer recursively.
 */
function scheduleDecoration(reveal = false) {
  shouldRevealSelection ||= reveal
  if (disposed || decorationFrame !== null) return
  decorationFrame = requestAnimationFrame(() => {
    decorationFrame = null
    if (disposed) return
    const revealCurrent = shouldRevealSelection
    shouldRevealSelection = false
    decorateNodes(revealCurrent)
    compactCanvasWidths()
  })
}

function displayPage(start: number) {
  pageStart.value = Math.max(0, Math.min(ordered.value.length - PAGE_SIZE, start))
}

function showActiveRow() {
  const viewport = scrollPane.value
  if (!viewport || !props.activeKey) return
  const row = [...viewport.querySelectorAll<HTMLElement>('[data-archive-history-key]')]
    .find((entry) => messageKey(entry.dataset.archiveHistoryKey ?? '') === props.activeKey)
  if (!row) return
  const bounds = viewport.getBoundingClientRect()
  const rect = row.getBoundingClientRect()
  if (rect.top < bounds.top + 54 || rect.bottom > bounds.bottom - 16)
    viewport.scrollTop += (rect.top + rect.height / 2) - (bounds.top + bounds.height / 2)
}

function decorateNodes(scrollIntoView = false) {
  const target = holder.value
  const viewport = scrollPane.value
  if (!target) return
  let current: SVGGElement | null = null
  const labelPositions = new Map<Element, Array<{ button: HTMLButtonElement; y: number }>>()
  const labels = new Map(
    [...target.querySelectorAll<HTMLButtonElement>('button[data-archive-history-key]')]
      .map((button) => [button.dataset.archiveHistoryKey, button]),
  )
  for (const circle of target.querySelectorAll<SVGCircleElement>('svg circle[id]')) {
    const item = data.value.byId.get(circle.id)
    const group = circle.closest('defs')?.parentElement
    if (!item || !(group instanceof SVGGElement)) continue
    // GitGraph puts the named <circle> in <defs>. The rendered, clickable dot
    // is its sibling <use>; focus and selection belong to the visible <g>.
    group.dataset.archiveGraphNode = circle.id
    group.setAttribute('role', 'button')
    group.setAttribute('tabindex', '0')
    group.setAttribute('aria-label', `${item.kind === 'user' ? (props.locale === 'ru' ? 'Вы' : 'You') : (props.locale === 'ru' ? 'Ассистент' : 'Assistant')}: ${item.text.slice(0, 100)}`)
    const selected = item.record.messageKey === props.activeKey
    group.setAttribute('aria-current', selected ? 'true' : 'false')
    const label = labels.get(circle.id)
    if (label) {
      label.setAttribute('aria-current', selected ? 'true' : 'false')
      const section = label.closest('.booster-gitgraph-segment')
      if (section) {
        const dotBounds = group.getBoundingClientRect()
        const sectionBounds = section.getBoundingClientRect()
        const entries = labelPositions.get(section) ?? []
        entries.push({
          button: label,
          y: dotBounds.top + dotBounds.height / 2 - sectionBounds.top,
        })
        labelPositions.set(section, entries)
      }
    }
    if (selected) current = group
  }
  // Sibling commits can share a GitGraph Y coordinate. Labels are readable
  // rows, so resolve their collisions independently of the underlying edges.
  for (const [section, entries] of labelPositions) {
    entries.sort((a, b) => a.y - b.y)
    let nextTop = 0
    for (const entry of entries) {
      const top = Math.max(nextTop, Math.round(entry.y - 14))
      entry.button.style.top = `${top}px`
      nextTop = top + 30
    }
    const svg = section.querySelector('svg')
    section.setAttribute('style', `min-height:${Math.max(nextTop + 6, svg?.getBoundingClientRect().height ?? 0)}px`)
  }
  if (scrollIntoView && !current) showActiveRow()
  if (scrollIntoView && current && viewport) {
    const dot = current.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    if (dot.top < bounds.top + 48 || dot.bottom > bounds.bottom - 12)
      viewport.scrollTop += (dot.top + dot.height / 2) - (bounds.top + bounds.height / 2)
  }
}

/** GitGraph sizes SVG from its full internal box, including unused message room.
 * Without viewBox, CSS width crops the blank right edge without scaling nodes.
 */
function compactCanvasWidths() {
  const root = holder.value
  if (!root) return
  for (const mount of root.querySelectorAll<HTMLElement>('.booster-gitgraph-segment-canvas')) {
    const svg = mount.querySelector('svg')
    if (!svg || svg.hasAttribute('viewBox')) continue
    const origin = svg.getBoundingClientRect().left
    const visibleDots = mount.querySelectorAll<SVGUseElement>('g[data-archive-graph-node] > use')
    if (!visibleDots.length) continue
    let usedWidth = 0
    for (const dot of visibleDots) usedWidth = Math.max(usedWidth, dot.getBoundingClientRect().right - origin)
    const width = Math.max(62, Math.ceil(usedWidth + 16))
    svg.style.width = `${width}px`
    mount.style.width = `${width}px`
    const labels = mount.parentElement?.querySelector<HTMLElement>('.booster-gitgraph-segment-labels')
    if (labels) labels.style.left = `${Math.min(width + 9, 175)}px`
  }
}

function renderGraph() {
  const target = holder.value
  if (!target || disposed) return
  target.replaceChildren()
  if (sparseHistory.value) return
  for (const [index, segment] of segments.value.entries()) {
    const section = document.createElement('div')
    section.className = 'booster-gitgraph-segment'
    if (index > 0 || segment.clipped) {
      const gap = document.createElement('div')
      gap.className = 'booster-gitgraph-gap'
      gap.setAttribute('role', 'note')
      gap.setAttribute('aria-label', props.locale === 'ru' ? 'Нет подтверждённого соединения' : 'No verified connection')
      gap.textContent = '···'
      section.appendChild(gap)
    }
    const svgMount = document.createElement('div')
    svgMount.className = 'booster-gitgraph-segment-canvas'
    section.appendChild(svgMount)
    const labels = document.createElement('div')
    labels.className = 'booster-gitgraph-segment-labels'
    for (const commit of segment.commits) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'booster-graph-message'
      button.dataset.archiveHistoryKey = commit.hash
      button.title = messageText(commit.hash).slice(0, 240)
      const role = document.createElement('span')
      role.className = 'booster-graph-message-role'
      role.textContent = messageLabel(commit.hash)
      const preview = document.createElement('span')
      preview.className = 'booster-graph-message-preview'
      preview.textContent = messageText(commit.hash).slice(0, 105) || '…'
      button.append(role, preview)
      labels.appendChild(button)
    }
    section.appendChild(labels)
    target.appendChild(section)
    const graph = createGitgraph(svgMount, {
      orientation: Orientation.VerticalReverse,
      mode: Mode.Compact,
      template: templateExtend(TemplateName.Metro, {
        colors: ['#679fea', '#4bbd9d', '#c18bed', '#e8a859', '#dd769b'],
        branch: { spacing: 19, lineWidth: 2, label: { display: false } },
        commit: { spacing: 30, dot: { size: 5 }, message: { display: false }, hasTooltipInCompactMode: false },
      }),
    })
    graph.import(segment.commits)
  }
  // Internal SVG updates are observed separately. Decoration remains valid
  // even when GitGraph replaces the visible groups after this call.
  scheduleDecoration(true)
}

function navigateFrom(target: Element | null) {
  const label = target?.closest<HTMLElement>('[data-archive-history-key]')
  const group = target?.closest<SVGGElement>('g[data-archive-graph-node]')
  const id = label?.dataset.archiveHistoryKey ?? group?.dataset.archiveGraphNode
  const item = id ? data.value.byId.get(id) : null
  if (item) emit('navigate', item.record.messageKey)
}
function onClick(event: MouseEvent) {
  navigateFrom(event.target instanceof Element ? event.target : null)
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const target = event.target
  if (!(target instanceof SVGGElement) || !target.dataset.archiveGraphNode) return
  event.preventDefault()
  navigateFrom(target)
}

onMounted(() => {
  if (holder.value) {
    graphObserver = new MutationObserver(() => scheduleDecoration())
    graphObserver.observe(holder.value, { childList: true, subtree: true })
  }
  void nextTick(() => {
    renderGraph()
    requestAnimationFrame(() => {
      if (disposed) return
      if (props.activeKey) showActiveRow()
      else if (scrollPane.value) scrollPane.value.scrollTop = scrollPane.value.scrollHeight
    })
  })
})
watch([() => props.thread, pageStart], () => { void nextTick(renderGraph) })
watch(() => props.activeKey, (key) => {
  if (!key) return
  if (sparseHistory.value) {
    void nextTick(showActiveRow)
    return
  }
  const index = ordered.value.findIndex((commit) => data.value.byId.get(commit.hash)?.record.messageKey === key)
  if (index < 0) return
  if (index < pageStart.value || index >= pageEnd.value) {
    displayPage(index - Math.floor(PAGE_SIZE / 2))
  } else {
    void nextTick(() => scheduleDecoration(true))
  }
})
onBeforeUnmount(() => {
  disposed = true
  graphObserver?.disconnect()
  if (decorationFrame !== null) cancelAnimationFrame(decorationFrame)
})
</script>
<template>
  <aside
    ref="scrollPane" class="booster-archive-flow-graph"
    :aria-label="locale === 'ru' ? 'Навигатор сохранённой истории' : 'Saved history navigator'"
    @keydown.esc.stop="emit('close')"
  >
    <header class="booster-history-header">
      <div>
        <div class="booster-history-heading">{{ locale === 'ru' ? 'История сообщений' : 'Message history' }}</div>
        <p>{{ ordered.length }} {{ locale === 'ru' ? 'сохранённых сообщений' : 'saved messages' }}</p>
      </div>
      <button type="button" class="booster-history-close"
        :aria-label="locale === 'ru' ? 'Закрыть историю' : 'Close history'"
        @click="emit('close')">×</button>
    </header>
    <div class="booster-history-state">
      <span class="booster-history-state-dot" :class="{ 'is-unverified': sparseHistory }"></span>
      <span>{{ sparseHistory
        ? (locale === 'ru' ? 'Связи не восстановлены' : 'Unverified links')
        : (locale === 'ru' ? 'Подтверждённые связи' : 'Recorded links') }}</span>
      <span class="booster-history-range">{{ pageStart + 1 }}–{{ pageEnd }} / {{ ordered.length }}</span>
    </div>
    <p class="booster-history-explainer">
      {{ sparseHistory
        ? (locale === 'ru'
          ? 'Для этого диалога недостаточно подтверждённых связей. Показан порядок сохранённых сообщений, без вымышленных веток.'
          : 'Not enough verified ancestry. Showing saved messages in order, without invented branches.')
        : (locale === 'ru'
          ? 'Нажмите на сообщение, чтобы перейти к нему. Линии показывают только сохранённые связи.'
          : 'Select a message to read it. Lines show recorded parent links only.') }}
    </p>
    <div v-if="data.missingParents || data.cyclicParents" class="booster-history-evidence">
      {{ locale === 'ru' ? 'Неизвестных родителей' : 'Unknown parents' }}: {{ data.missingParents }}
      <span v-if="data.cyclicParents"> · {{ locale === 'ru' ? 'Циклы' : 'Cycles' }}: {{ data.cyclicParents }}</span>
    </div>
    <div v-if="sparseHistory" class="booster-history-list">
      <button v-for="(item, index) in pageItems" :key="item.hash"
        class="booster-history-list-row" type="button"
        :aria-current="messageKey(item.hash) === activeKey ? 'true' : undefined"
        :data-archive-history-key="item.hash"
        @click="emit('navigate', messageKey(item.hash))">
        <span class="booster-history-list-rail"><span class="booster-history-list-dot" :class="{ 'is-user': isUser(item.hash) }"></span></span>
        <span class="booster-history-list-copy">
          <span class="booster-history-list-meta">{{ messageLabel(item.hash) }} · {{ pageStart + index + 1 }}</span>
          <span class="booster-history-list-preview">{{ messageText(item.hash) || '…' }}</span>
        </span>
      </button>
    </div>
    <div v-show="!sparseHistory" ref="holder" class="booster-gitgraph-content"
      role="group" @click="onClick" @keydown="onKeydown"></div>
    <footer class="booster-history-footer">
      <button type="button" :disabled="pageStart === 0"
        :aria-label="locale === 'ru' ? 'Ранее в графе' : 'Earlier graph nodes'"
        @click="displayPage(pageStart - PAGE_SIZE)">← {{ locale === 'ru' ? 'Ранее' : 'Earlier' }}</button>
      <button type="button" :disabled="pageEnd >= ordered.length"
        :aria-label="locale === 'ru' ? 'Позже в графе' : 'Later graph nodes'"
        @click="displayPage(pageStart + PAGE_SIZE)">{{ locale === 'ru' ? 'Позже' : 'Later' }} →</button>
    </footer>
  </aside>
</template>
