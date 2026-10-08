<script setup lang="ts">
import { computed } from 'vue'
import { VueFlow, Handle, Position } from '@vue-flow/core'
import type { NodeMouseEvent } from '@vue-flow/core'
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import { layoutArchiveFlow } from './archive-flow-layout'

const props = defineProps<{ thread: ArchiveThreadView; locale: 'ru' | 'en' }>()
const emit = defineEmits<{ navigate: [key: string] }>()
const layout = computed(() => layoutArchiveFlow(props.thread))
function activate(event: NodeMouseEvent) {
  const key = (event.node.data as { key?: string })?.key
  if (key) emit('navigate', key)
}
</script>
<template>
  <div class="booster-archive-flow-graph" :aria-label="locale === 'ru' ? 'Граф ветвей диалога' : 'Conversation branch graph'">
    <VueFlow
      :key="thread.recordCount"
      :nodes="layout.nodes"
      :edges="layout.edges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :zoom-on-scroll="false"
      :zoom-on-pinch="false"
      :pan-on-scroll="true"
      :fit-view-on-init="true"
      :min-zoom="0.12"
      :max-zoom="2"
      :default-edge-options="{ animated: false, style: { stroke: 'var(--primary)', strokeWidth: 2 } }"
      @node-click="activate"
    >
      <template #node-archive="{ data }">
        <div class="booster-flow-node" :class="{ 'is-user': data.kind === 'user' }" :title="data.text.slice(0, 175)" :aria-label="data.text.slice(0, 90)">
          <Handle type="target" :position="Position.Top" class="booster-flow-handle" />
          <span>{{ data.kind === 'user' ? '●' : '■' }}</span>
          <Handle type="source" :position="Position.Bottom" class="booster-flow-handle" />
        </div>
      </template>
    </VueFlow>
  </div>
</template>
