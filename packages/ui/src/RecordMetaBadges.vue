<script setup lang="ts">
import type { ConversationItemMetadataView } from '@chatgpt-booster/core'
import { BrainCircuit, Clock3 } from 'lucide-vue-next'
import { computed } from 'vue'
import FloatingInfoPopover from './FloatingInfoPopover.vue'
import { translate, type SupportedLocale } from './i18n'

const props = withDefaults(
  defineProps<{
    metadata: ConversationItemMetadataView
    locale: SupportedLocale
    showModel?: boolean
    compact?: boolean
  }>(),
  { showModel: true, compact: false },
)
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
const timeLabel = computed(() => {
  const parts = [sent.value && t('reader.sentAt') + ': ' + sent.value]
  if (props.metadata.edited && edited.value)
    parts.push(t('reader.editedAt') + ': ' + edited.value)
  return parts.filter(Boolean).join('\n') || t('reader.timeUnknown')
})
const modelLabel = computed(() =>
  [
    props.metadata.model && t('reader.model') + ': ' + props.metadata.model,
    props.metadata.thinking && t('reader.thinking') + ': ' + props.metadata.thinking,
  ]
    .filter(Boolean)
    .join('\n'),
)
</script>

<template>
  <span class="booster-meta-badges" :class="{ compact }">
    <FloatingInfoPopover :aria-label="timeLabel">
      <template #trigger><Clock3 class="size-3.5" /></template>
      <div class="booster-meta-lines">
        <strong class="booster-meta-label">{{ t('reader.sentAt') }}</strong><span class="booster-meta-value">{{ sent || t('reader.timeUnknown') }}</span>
        <template v-if="metadata.edited && edited">
          <strong class="booster-meta-label">{{ t('reader.editedAt') }}</strong><span class="booster-meta-value">{{ edited }}</span>
        </template>
      </div>
    </FloatingInfoPopover>
    <FloatingInfoPopover v-if="showModel && modelLabel" :aria-label="modelLabel">
      <template #trigger><BrainCircuit class="size-3.5" /></template>
      <div class="booster-meta-lines">
        <template v-if="metadata.model">
          <strong class="booster-meta-label">{{ t('reader.model') }}</strong><span class="booster-meta-value">{{ metadata.model }}</span>
        </template>
        <template v-if="metadata.thinking">
          <strong class="booster-meta-label">{{ t('reader.thinking') }}</strong><span class="booster-meta-value">{{ metadata.thinking }}</span>
        </template>
      </div>
    </FloatingInfoPopover>
  </span>
</template>
