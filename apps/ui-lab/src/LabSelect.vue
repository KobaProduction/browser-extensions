<script setup lang="ts">
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kobaproduction/browser-ui'
import { useId } from 'vue'

defineProps<{
  modelValue: string
  label: string
  options: readonly { value: string; label: string }[]
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
</script>
<template>
  <div class="grid min-w-0 gap-2">
    <Label :for="id">{{ label }}</Label>
    <Select :model-value="modelValue" :disabled="disabled" @update:model-value="typeof $event === 'string' && emit('update:modelValue',$event)">
      <SelectTrigger :id="id" class="w-full min-w-0"><SelectValue :placeholder="label" /></SelectTrigger>
      <SelectContent><SelectItem v-for="item in options" :key="item.value" :value="item.value" :data-lab-value="item.value">{{ item.label }}</SelectItem></SelectContent>
    </Select>
  </div>
</template>
