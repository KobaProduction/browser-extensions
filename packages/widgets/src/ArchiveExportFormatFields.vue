<script setup lang="ts">
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kobaproduction/browser-ui'
import type { ArchiveExportChoice } from './archive-export-format-fields'

const props = defineProps<{
  format: string
  packaging: string
  formats: readonly ArchiveExportChoice[]
  packages: readonly ArchiveExportChoice[]
  formatLabel: string
  packagingLabel: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:format': [value: string]
  'update:packaging': [value: string]
}>()
function chooseFormat(value: unknown) {
  if (typeof value === 'string' && props.formats.some((choice) => choice.id === value))
    emit('update:format', value)
}
function choosePackaging(value: unknown) {
  if (typeof value === 'string' && props.packages.some((choice) => choice.id === value))
    emit('update:packaging', value)
}
</script>

<template>
  <div class="grid min-w-0 gap-3" data-archive-export-format-fields>
    <Label class="grid min-w-0 gap-2">
      {{ formatLabel }}
      <Select :model-value="format" :disabled="disabled" @update:model-value="chooseFormat">
        <SelectTrigger class="w-full min-w-0" :aria-label="formatLabel"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem v-for="choice in formats" :key="choice.id" :value="choice.id">{{ choice.label }}</SelectItem></SelectContent>
      </Select>
    </Label>
    <Label class="grid min-w-0 gap-2">
      {{ packagingLabel }}
      <Select :model-value="packaging" :disabled="disabled" @update:model-value="choosePackaging">
        <SelectTrigger class="w-full min-w-0" :aria-label="packagingLabel"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem v-for="choice in packages" :key="choice.id" :value="choice.id">{{ choice.label }}</SelectItem></SelectContent>
      </Select>
    </Label>
  </div>
</template>
