<script setup lang="ts">
/** Provider-neutral capture controls. Identity, collection and persistence belong to the caller. */
import { Button, useLocalizedText } from '@kobaproduction/browser-ui'
import { ArrowUpToLine, Square } from 'lucide-vue-next'
import ArchiveProgressBar from './ArchiveProgressBar.vue'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(WIDGET_UI_MESSAGES)

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
    <Button v-if="!busy" type="button" variant="outline" size="sm" :disabled="disabled" @click="emit('start')">
      <ArrowUpToLine class="size-4" aria-hidden="true" />{{ label }}
    </Button>
    <Button v-else type="button" variant="outline" size="sm" @click="emit('stop')">
      <Square class="size-4" aria-hidden="true" />{{ text(stopLabel) }}
    </Button>
    <ArchiveProgressBar v-if="total !== null && total !== undefined && total > 0"
      :label="label" :percent="Math.max(0, Math.min(100, Math.round(100 * (processed ?? 0) / total)))"
      :counter="`${processed ?? 0} / ${total}`" compact />
    <span v-if="saved !== undefined && saved !== null" class="text-xs text-muted-foreground" role="status">
      {{ text(savedLabel) }}: {{ saved }}
    </span>
  </div>
</template>
