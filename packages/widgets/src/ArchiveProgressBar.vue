<script setup lang="ts">
import { ArchiveProgress } from '@kobaproduction/browser-ui'

/** VK-compatible adapter to the exact same provider-neutral progress widget
 * used by ChatGPT backup/export. Zero remains known 0%, null indeterminate. */
const props = withDefaults(
  defineProps<{
    label: string
    percent: number | null
    counter?: string
    percentLabel?: string
    compact?: boolean
  }>(),
  { compact: false },
)
</script>
<template>
  <ArchiveProgress
    :label="label"
    :completed="percent"
    :total="100"
    :compact="compact"
    :detail="counter ? `${counter}${percent !== null && percentLabel ? ` · ${percentLabel} ${percent}%` : ''}` : null"
  />
</template>
