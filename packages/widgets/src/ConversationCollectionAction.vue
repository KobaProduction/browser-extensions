<script setup lang="ts">
/** Provider-neutral capture controls. Identity, collection and persistence belong to the caller. */
import { Button, useLocalizedText } from '@kobaproduction/browser-ui'
import { ArrowUpToLine, Square } from 'lucide-vue-next'
import { computed } from 'vue'
import ArchiveProgressBar from './ArchiveProgressBar.vue'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(WIDGET_UI_MESSAGES)

const props = withDefaults(
  defineProps<{
    label: string
    variant?: 'outline' | 'ghost'
    busy: boolean
    disabled?: boolean
    processed?: number | null
    reused?: number
    total?: number | null
    saved?: number | null
    stopLabel?: string
    savedLabel?: string
  }>(),
  { disabled: false, variant: 'outline', reused: 0, stopLabel: 'Остановить', savedLabel: 'Сохранено' },
)
const covered = computed(() => Math.max(0, props.processed ?? 0) + Math.max(0, props.reused))
const emit = defineEmits<{ start: []; stop: [] }>()
</script>
<template>
  <div class="booster-conversation-collection grid justify-items-start gap-2">
    <Button v-if="!busy" type="button" :variant="variant" size="sm" :disabled="disabled" @click="emit('start')">
      <ArrowUpToLine class="size-4" aria-hidden="true" />{{ label }}
    </Button>
    <Button v-else type="button" :variant="variant" size="sm" @click="emit('stop')">
      <Square class="size-4" aria-hidden="true" />{{ text(stopLabel) }}
    </Button>
    <ArchiveProgressBar v-if="total !== null && total !== undefined && total > 0"
      :label="label" :percent="Math.max(0, Math.min(100, Math.round(100 * covered / total)))"
      :counter="`${covered} / ${total}`" compact />
    <span v-if="saved !== undefined && saved !== null" class="text-xs text-muted-foreground" role="status">
      {{ text(savedLabel) }}: {{ saved }}
    </span>
  </div>
</template>
