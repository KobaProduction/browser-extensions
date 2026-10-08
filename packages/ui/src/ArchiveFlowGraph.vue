<script setup lang="ts">
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import { createGitgraph, Mode, Orientation, TemplateName, templateExtend } from '@gitgraph/js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { archiveGitgraphData, archiveGitgraphSegments } from './archive-gitgraph'

const PAGE_SIZE = 140
const props = defineProps<{ thread: ArchiveThreadView; locale: 'ru' | 'en'; activeKey?: string | null }>()
const emit = defineEmits<{ navigate: [key: string] }>()
const holder = ref<HTMLElement | null>(null)
const scrollPane = ref<HTMLElement | null>(null)
const data = computed(() => archiveGitgraphData(props.thread))
const ordered = computed(() => [...data.value.commits].reverse())
const pageStart = ref(Math.max(0, ordered.value.length - PAGE_SIZE))
const pageEnd = computed(() => Math.min(ordered.value.length, pageStart.value + PAGE_SIZE))
const segments = computed(() => archiveGitgraphSegments(ordered.value.slice(pageStart.value, pageEnd.value).reverse()))
const notLinked = computed(() => Math.max(0, segments.value.length - 1))
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

const description = computed(() => props.locale === 'ru'
  ? `Отдельных фрагментов истории: ${segments.value.length}. Связи между фрагментами не подтверждены.`
  : `Separate history fragments: ${segments.value.length}. No verified links between fragments.`)

function displayPage(start: number) {
  pageStart.value = Math.max(0, Math.min(ordered.value.length - PAGE_SIZE, start))
}

function decorateNodes(scrollIntoView = false) {
  const target = holder.value
  const viewport = scrollPane.value
  if (!target) return
  let current: SVGGElement | null = null
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
    if (selected) current = group
  }
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
  }
}

function renderGraph() {
  const target = holder.value
  if (!target || disposed) return
  target.replaceChildren()
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
    target.appendChild(section)
    const graph = createGitgraph(svgMount, {
      orientation: Orientation.VerticalReverse,
      mode: Mode.Compact,
      template: templateExtend(TemplateName.Metro, {
        colors: ['#679fea', '#4bbd9d', '#c18bed', '#e8a859', '#dd769b'],
        branch: { spacing: 19, lineWidth: 2, label: { display: false } },
        commit: { spacing: 30, dot: { size: 5 }, message: { display: false }, hasTooltipInCompactMode: true },
      }),
    })
    graph.import(segment.commits)
  }
  // Internal SVG updates are observed separately. Decoration remains valid
  // even when GitGraph replaces the visible groups after this call.
  scheduleDecoration(true)
}

function navigateFrom(target: Element | null) {
  const group = target?.closest<SVGGElement>('g[data-archive-graph-node]')
  const id = group?.dataset.archiveGraphNode
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
  void nextTick(renderGraph)
})
watch([() => props.thread, pageStart], () => { void nextTick(renderGraph) })
watch(() => props.activeKey, (key) => {
  if (!key) return
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
  <aside ref="scrollPane" class="booster-archive-flow-graph" :aria-label="locale === 'ru' ? 'Граф ветвей диалога' : 'Conversation branch graph'">
    <div class="booster-gitgraph-header">
      <span :title="description">{{ locale === 'ru' ? 'История' : 'History' }} · {{ pageStart + 1 }}–{{ pageEnd }}/{{ ordered.length }}</span>
      <div class="booster-gitgraph-pager">
        <button type="button" :disabled="pageStart === 0" :aria-label="locale === 'ru' ? 'Ранее в графе' : 'Earlier graph nodes'" @click="displayPage(pageStart - PAGE_SIZE)">↑</button>
        <button type="button" :disabled="pageEnd >= ordered.length" :aria-label="locale === 'ru' ? 'Позже в графе' : 'Later graph nodes'" @click="displayPage(pageStart + PAGE_SIZE)">↓</button>
      </div>
    </div>
    <p v-if="notLinked" class="booster-gitgraph-warning" :title="description">{{ locale === 'ru' ? 'Разрывы связей' : 'Unlinked paths' }}: {{ notLinked }}</p>
    <p v-if="data.unresolved" class="booster-gitgraph-warning">
      {{ locale === 'ru' ? 'Неизвестные родители' : 'Missing parents' }}: {{ data.missingParents }}
      · {{ locale === 'ru' ? 'Циклы' : 'Cycles' }}: {{ data.cyclicParents }}
    </p>
    <div ref="holder" class="booster-gitgraph-content" role="group" @click="onClick" @keydown="onKeydown"></div>
  </aside>
</template>
