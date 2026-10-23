<script setup lang="ts">
import { FloatingInfoPopover } from '@kobaproduction/browser-ui'
import Clock3 from 'lucide-vue-next/dist/esm/icons/clock-3.js'
import type { SupportedLocale } from './i18n'
import { translate } from './i18n'
import MessageMetadataDetails from './MessageMetadataDetails.vue'
import type { LiveMessageMetadataView } from './message-metadata'

const props = defineProps<{ metadata: LiveMessageMetadataView; now: number; locale: SupportedLocale }>()
function duration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return ms < 60_000
    ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
</script>
<template>
  <FloatingInfoPopover mode="hover-click" :label="translate(locale, 'messageMeta.title')" :trigger-class="metadata.summaryIntervalMs != null || metadata.activity?.durationMs != null ? 'booster-meta-trigger-time w-auto gap-1 px-1.5' : ''">
    <template #trigger><Clock3 class="size-3.5" /><span v-if="metadata.summaryIntervalMs != null || metadata.activity?.durationMs != null" class="booster-meta-time-text tabular-nums">{{ metadata.summaryIntervalMs != null ? '+' + duration(metadata.summaryIntervalMs) : duration(metadata.activity?.durationMs ?? 0) }}</span></template>
    <template #default="{ pinned }"><MessageMetadataDetails :metadata="props.metadata" :now="now" :locale="locale" :pinned="pinned" /></template>
  </FloatingInfoPopover>
</template>
