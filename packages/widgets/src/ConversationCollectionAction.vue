<script setup lang="ts">
/** Provider-neutral capture controls. Identity, collection and persistence belong to the caller. */
import { ArrowUpToLine, Square } from 'lucide-vue-next'
import ArchiveProgressBar from './ArchiveProgressBar.vue'

const props = withDefaults(
  defineProps<{
    label: string
    busy: boolean
    disabled?: boolean
    processed?: number | null
    total?: number | null
    saved?: number | null
    stopLabel?: string
    savedLabel?: string
  }>(),
  { disabled: false, stopLabel: 'Остановить', savedLabel: 'Сохранено' },
)
const emit = defineEmits<{ start: []; stop: [] }>()
</script>
<template>
  <div class="booster-conversation-collection">
    <button v-if="!busy" type="button" class="booster-action-secondary" :disabled="disabled" @click="emit('start')">
      <ArrowUpToLine class="size-4" aria-hidden="true" />{{ label }}
    </button>
    <button v-else type="button" class="booster-action-secondary" @click="emit('stop')">
      <Square class="size-4" aria-hidden="true" />{{ stopLabel }}
    </button>
    <ArchiveProgressBar v-if="total !== null && total !== undefined && total > 0"
      :label="label" :percent="Math.max(0, Math.min(100, Math.round(100 * (processed ?? 0) / total)))"
      :counter="`${processed ?? 0} / ${total}`" compact />
    <span v-if="saved !== undefined && saved !== null" class="text-xs text-muted-foreground" role="status">
      {{ savedLabel }}: {{ saved }}
    </span>
  </div>
</template>
