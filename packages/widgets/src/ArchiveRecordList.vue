<script setup lang="ts" generic="T">
/** Record identity/focus/selection are reusable; native content remains in its provider slot. */

import { Checkbox, useLocalizedText } from '@kobaproduction/browser-ui'
import type { ArchiveRecordListProps } from './archive-record-list'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(WIDGET_UI_MESSAGES)

const props = defineProps<ArchiveRecordListProps<T>>()
const emit = defineEmits<{ select: [messageId: string, checked: boolean] }>()
defineSlots<{ record(props: { record: T; index: number }): unknown }>()
function selected(record: T) {
  return props.selectedIds?.has(String(props.messageId(record))) === true
}
function toggle(record: T, checked: boolean | 'indeterminate') {
  emit('select', String(props.messageId(record)), checked === true)
}
</script>

<template>
  <div class="booster-archive-record-list" :class="spaced ? 'grid gap-3' : 'contents'">
    <div v-for="(record, index) in records" :key="recordKey(record)" :data-archive-node="recordKey(record)"
      :data-archive-message="messageId(record)" tabindex="-1" class="booster-archive-record-row min-w-0"
      :class="{ 'booster-message-target': highlightTarget !== false && targetMessageId != null && String(targetMessageId) === String(messageId(record)), 'outline-none': highlightTarget === false, 'booster-archive-record-selectable grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5': selectable }">
      <Checkbox v-if="selectable" class="mt-3"
        :aria-label="selectionLabel?.(record) || `${text('Выбрать сообщение')} ${messageId(record)}`"
        :model-value="selected(record)" :disabled="disabled" @update:model-value="toggle(record, $event)" />
      <slot name="record" :record="record" :index="index" />
    </div>
  </div>
</template>
