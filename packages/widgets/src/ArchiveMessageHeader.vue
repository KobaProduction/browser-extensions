<script setup lang="ts">
/** Shared reader metadata/header. Source-specific labels and raw records are supplied by adapters. */
import { FloatingInfoPopover, JsonViewer } from '@kobaproduction/browser-ui'
import { Info } from 'lucide-vue-next'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    author: string
    sentAt?: number | null
    locale?: string
    metadata?: unknown
    inspectLabel?: string
  }>(),
  { sentAt: null, locale: 'ru-RU', inspectLabel: 'Метаданные сообщения' },
)
const timestamp = computed(() => {
  const raw = props.sentAt
  if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) return null
  const milliseconds = raw < 10_000_000_000 ? raw * 1000 : raw
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date
})
const readable = computed(
  () =>
    timestamp.value?.toLocaleString(props.locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) ?? '',
)
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <strong class="min-w-0 break-words text-foreground">{{ author }}</strong>
    <time v-if="timestamp" :datetime="timestamp.toISOString()" class="text-muted-foreground">{{ readable }}</time>
    <FloatingInfoPopover v-if="metadata !== undefined" mode="hover-click" :label="inspectLabel">
      <template #trigger><Info class="size-3.5" aria-hidden="true" /></template>
      <div class="max-h-80 max-w-[min(380px,85vw)] overflow-auto p-2 text-xs">
        <JsonViewer :value="metadata" />
      </div>
    </FloatingInfoPopover>
  </div>
</template>
