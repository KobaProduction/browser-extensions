<script setup lang="ts">
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import { createGitgraph, Mode, Orientation, TemplateName, templateExtend } from '@gitgraph/js'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { archiveGitgraphData } from './archive-gitgraph'

const props = defineProps<{ thread: ArchiveThreadView; locale: 'ru' | 'en' }>()
const emit = defineEmits<{ navigate: [key: string] }>()
const holder = ref<HTMLElement | null>(null)
let stop = false
function renderGraph() {
  const target = holder.value
  if (!target || stop) return
  target.replaceChildren()
  const data = archiveGitgraphData(props.thread)
  if (!data.commits.length) return
  const graph = createGitgraph(target, {
    orientation: Orientation.VerticalReverse,
    mode: Mode.Compact,
    template: templateExtend(TemplateName.Metro, {
      colors: ['#679fea', '#4bbd9d', '#c18bed', '#e8a859', '#dd769b'],
      branch: { spacing: 19, lineWidth: 2, label: { display: false } },
      commit: { spacing: 27, dot: { size: 4 }, message: { display: false }, hasTooltipInCompactMode: true },
    }),
  })
  graph.import(data.commits)
  // GitGraph's imported SVG dots carry the exact message ID on <circle>.
  // Use event delegation because GitGraph rebuilds SVG nodes on updates.
  const activate = (event: MouseEvent) => {
    const path = event.composedPath()
    const circle = path.find(node => node instanceof SVGCircleElement && node.id && data.byId.has(node.id)) as SVGCircleElement | undefined
    // Clicking a dot's parent <g> is also supported.
    const element = event.target as Element | null
    const group = element?.closest('g')
    const fallback = group?.querySelector<SVGCircleElement>('circle[id]')
    const id = circle?.id ?? fallback?.id
    const record = id ? data.byId.get(id) : undefined
    if (record) emit('navigate', record.record.messageKey)
  }
  target.onclick = activate
}
onMounted(() => { void nextTick(renderGraph) })
watch(() => props.thread, () => { void nextTick(renderGraph) })
onBeforeUnmount(() => { stop = true; if (holder.value) holder.value.onclick = null })
</script>
<template>
  <div class="booster-archive-flow-graph" :aria-label="locale === 'ru' ? 'Граф ветвей диалога' : 'Conversation branch graph'">
    <div ref="holder" class="booster-gitgraph-content"></div>
  </div>
</template>
