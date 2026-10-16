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
  <div class="booster-archive-record-list">
    <div v-for="(record, index) in records" :key="recordKey(record)" :data-archive-node="recordKey(record)"
      :data-archive-message="messageId(record)" tabindex="-1" class="booster-archive-record-row"
      :class="{ 'booster-message-target': targetMessageId != null && String(targetMessageId) === String(messageId(record)), 'booster-archive-record-selectable': selectable }">
      <Checkbox v-if="selectable" class="mt-3"
        :aria-label="selectionLabel?.(record) || `${text('Выбрать сообщение')} ${messageId(record)}`"
        :model-value="selected(record)" :disabled="disabled" @update:model-value="toggle(record, $event)" />
      <slot name="record" :record="record" :index="index" />
    </div>
  </div>
</template>

<style scoped>
.booster-archive-record-list { display: contents; }
.booster-archive-record-row { min-width: 0; }
.booster-archive-record-selectable { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; align-items: start; }
</style>
