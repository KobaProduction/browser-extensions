<script setup lang="ts">
import type { ArchiveThreadView } from '@chatgpt-booster/core'
import { ArchiveTimeline, type ArchiveTimelineNode } from '@kobaproduction/browser-widgets'
import { computed } from 'vue'
import { archiveGitgraphData } from './archive-gitgraph'
import { archiveHistoryPreview } from './archive-history-preview'
import type { ArchiveDataAdapter } from './mount'

const props = defineProps<{
  thread: ArchiveThreadView
  locale: 'ru' | 'en'
  activeKey?: string | null
  timeline?: Awaited<ReturnType<NonNullable<ArchiveDataAdapter['getTimeline']>>>
  selectedMessageIds?: ReadonlySet<string>
  disabled?: boolean
  loading?: boolean
}>()
const emit = defineEmits<{ navigate: [key: string]; close: [] }>()
const data = computed(() => archiveGitgraphData(props.thread))
const nodes = computed<ArchiveTimelineNode[]>(() => {
  if (props.timeline?.length) {
    const keys = new Map(props.timeline.map((message) => [message.id, message.key]))
    return props.timeline.map((message) => ({
      id: message.key,
      parentId: message.parentId ? (keys.get(message.parentId) ?? null) : null,
      label:
        message.label === 'User'
          ? props.locale === 'ru'
            ? 'Вы'
            : 'You'
          : props.locale === 'ru'
            ? 'Ассистент'
            : 'Assistant',
      preview: archiveHistoryPreview(message.preview, props.locale),
      timestampMs: message.timestampMs ?? null,
      uncertain: message.uncertain,
    }))
  }
  const parents = new Map(data.value.commits.map((commit) => [commit.hash, commit.parents[0] ?? null]))
  const seen = new Set<string>()
  return props.thread.turns
    .flatMap((turn) => turn.messages)
    .filter((item) => {
      if (!parents.has(item.record.messageId) || seen.has(item.record.messageId)) return false
      seen.add(item.record.messageId)
      return true
    })
    .map((item) => {
      const parentId = parents.get(item.record.messageId)
      return {
        id: item.record.messageKey,
        parentId: parentId ? (data.value.byId.get(parentId)?.record.messageKey ?? null) : null,
        label:
          item.kind === 'user'
            ? props.locale === 'ru'
              ? 'Вы'
              : 'You'
            : props.locale === 'ru'
              ? 'Ассистент'
              : 'Assistant',
        preview: archiveHistoryPreview(item.text, props.locale),
        timestampMs: item.record.createTime === null ? null : item.record.createTime * 1000,
        uncertain: Boolean(item.record.parentId && !parents.get(item.record.messageId)),
      }
    })
})
const selectedKeys = computed(
  () =>
    new Set(
      props.timeline?.length
        ? props.timeline
            .filter((message) => props.selectedMessageIds?.has(message.id))
            .map((message) => message.key)
        : props.thread.turns
            .flatMap((turn) => [...turn.messages, ...turn.details])
            .filter((item) => props.selectedMessageIds?.has(item.record.messageId))
            .map((item) => item.record.messageKey),
    ),
)
</script>

<template>
  <div class="booster-archive-flow-graph" @keydown.esc.stop="emit('close')">
    <ArchiveTimeline :nodes="nodes" :active-id="activeKey" :selected-ids="selectedKeys" :disabled="disabled" :loading="loading" :label="locale === 'ru' ? 'Сообщение на таймлайне' : 'Message on timeline'" :empty-label="locale === 'ru' ? 'Нет сообщений' : 'No messages'" :uncertain-label="locale === 'ru' ? 'Неподтверждённая связь' : 'Unverified relationship'" @navigate="emit('navigate', $event)" />
  </div>
</template>
