<script setup lang="ts">
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  FloatingInfoPopover,
  JsonViewer,
} from '@kobaproduction/browser-ui'
import Clock3 from 'lucide-vue-next/dist/esm/icons/clock-3.js'
import { computed, ref } from 'vue'
import { type SupportedLocale, translate } from './i18n'
import type { LiveMessageMetadataView } from './message-metadata'

const props = defineProps<{ metadata: LiveMessageMetadataView; now: number; locale: SupportedLocale }>()
const rawExpanded = ref(false)
const t = (key: Parameters<typeof translate>[1]) => translate(props.locale, key)
function serverTime(value: number | null) {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}
function fullDate(value: number | null) {
  const time = serverTime(value)
  return time ? new Date(time).toLocaleString(props.locale) : null
}
const sent = computed(() => fullDate(props.metadata.sentAt))
const edited = computed(() => fullDate(props.metadata.editedAt))
const shortTime = computed(() => {
  const time = serverTime(props.metadata.sentAt)
  return time
    ? new Date(time).toLocaleString(props.locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'
})
function duration(value: number) {
  const ms = Math.max(0, value)
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const seconds = Math.floor(ms / 1000),
    minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${minutes}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
const activityLines = computed(() => {
  const activity = props.metadata.activity
  if (!activity) return []
  const request =
    activity.durationMs ??
    (activity.startedAt ? (activity.completedAt ?? props.now) - activity.startedAt : null)
  const reasoning =
    activity.reasoningDurationMs ??
    (activity.reasoningStartedAt
      ? (activity.completedAt ?? props.now) - activity.reasoningStartedAt
      : null)
  const rows: { label: string; value: string; pinned: boolean }[] = []
  if (request !== null)
    rows.push({ label: t('activity.requestDuration'), value: duration(request), pinned: false })
  if (reasoning !== null)
    rows.push({ label: t('activity.reasoningDuration'), value: duration(reasoning), pinned: false })
  for (const [key, value] of [
    ['activity.startedAt', activity.startedAt],
    ['activity.reasoningStartedAt', activity.reasoningStartedAt],
    ['activity.completedAt', activity.completedAt],
    ['activity.lastActivityAt', activity.lastActivityAt],
  ] as const)
    if (value)
      rows.push({ label: t(key), value: new Date(value).toLocaleString(props.locale), pinned: true })
  return rows
})
</script>

<template>
  <FloatingInfoPopover mode="hover-click" :label="t('messageMeta.title')" :trigger-class="metadata.summaryIntervalMs != null || metadata.activity?.durationMs != null ? 'booster-meta-trigger-time w-auto gap-1 px-1.5' : ''">
    <template #trigger><Clock3 class="size-3.5" /><span v-if="metadata.summaryIntervalMs != null || metadata.activity?.durationMs != null" class="booster-meta-time-text tabular-nums"><template v-if="metadata.summaryIntervalMs != null">+{{ duration(metadata.summaryIntervalMs) }}</template><template v-else-if="metadata.activity?.durationMs != null">{{ duration(metadata.activity.durationMs) }}</template></span></template>
    <template #default="{ pinned }">
      <div class="booster-message-meta-body">
        <header class="booster-message-meta-header"><strong>{{ t('messageMeta.title') }}</strong><span>{{ shortTime }}</span></header>
        <div class="booster-meta-lines">
          <strong class="booster-meta-label">{{ t('reader.sentAt') }}</strong><span class="booster-meta-value">{{ sent || t('reader.timeUnknown') }}</span>
          <template v-if="metadata.summaryIntervalMs != null"><strong class="booster-meta-label">{{ t('requestStatus.summaryInterval') }}</strong><span class="booster-meta-value">{{ duration(metadata.summaryIntervalMs) }}</span></template>
          <template v-if="metadata.edited && edited"><strong class="booster-meta-label">{{ t('reader.editedAt') }}</strong><span class="booster-meta-value">{{ edited }}</span></template>
          <template v-if="metadata.model"><strong class="booster-meta-label">{{ t('reader.model') }}</strong><span class="booster-meta-value">{{ metadata.model }}</span></template>
          <template v-if="metadata.thinking"><strong class="booster-meta-label">{{ t('reader.thinking') }}</strong><span class="booster-meta-value">{{ metadata.thinking }}</span></template>
          <template v-for="line in activityLines" :key="line.label">
            <template v-if="!line.pinned || pinned"><strong class="booster-meta-label">{{ line.label }}</strong><span class="booster-meta-value">{{ line.value }}</span></template>
          </template>
        </div>
        <Collapsible v-if="pinned && metadata.raw != null" v-model:open="rawExpanded">
          <CollapsibleTrigger as-child><Button type="button" variant="ghost" size="sm">{{ t(rawExpanded ? 'archive.hideRaw' : 'archive.showRaw') }}</Button></CollapsibleTrigger>
          <CollapsibleContent><JsonViewer :value="metadata.raw" /></CollapsibleContent>
        </Collapsible>
      </div>
    </template>
  </FloatingInfoPopover>
</template>
