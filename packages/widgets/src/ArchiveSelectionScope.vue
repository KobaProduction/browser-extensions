<script setup lang="ts">
import { Label, RadioGroup, RadioGroupItem, useLocalizedText } from '@kobaproduction/browser-ui'
import { useId } from 'vue'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(WIDGET_UI_MESSAGES)

withDefaults(
  defineProps<{
    modelValue: 'all' | 'selected'
    selectedCount: number
    disabled?: boolean
    label?: string
    allLabel?: string
    selectedLabel?: string
    emptyLabel?: string
  }>(),
  {
    label: 'Что экспортировать',
    allLabel: 'Все сохранённые сообщения',
    selectedLabel: 'Выбранные сообщения',
    emptyLabel: 'Выбери сообщения в архиве. Выбор сохраняется между страницами.',
  },
)
const emit = defineEmits<{ 'update:modelValue': [value: 'all' | 'selected'] }>()
const groupId = useId()
function choose(value: unknown) {
  if (value === 'all' || value === 'selected') emit('update:modelValue', value)
}
</script>

<template>
  <section class="grid min-w-0 gap-2" :aria-label="text(label)">
    <p class="m-0 text-xs font-medium">{{ text(label) }}</p>
    <RadioGroup :model-value="modelValue" :disabled="disabled" :aria-label="text(label)" class="flex flex-wrap gap-x-4 gap-y-2" @update:model-value="choose">
      <div class="flex items-center gap-2"><RadioGroupItem :id="`${groupId}-all`" value="all" /><Label :for="`${groupId}-all`">{{ text(allLabel) }}</Label></div>
      <div class="flex items-center gap-2"><RadioGroupItem :id="`${groupId}-selected`" value="selected" /><Label :for="`${groupId}-selected`">{{ text(selectedLabel) }} · {{ selectedCount }}</Label></div>
    </RadioGroup>
    <p v-if="modelValue === 'selected' && selectedCount === 0" role="status" class="m-0 text-xs text-muted-foreground">{{ text(emptyLabel) }}</p>
  </section>
</template>
