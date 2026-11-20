<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  compact?: boolean
}>()
</script>

<template>
  <div :class="cn('flex flex-col gap-y-1.5', compact ? 'p-3' : 'p-6', props.class)">
    <slot />
  </div>
</template>
