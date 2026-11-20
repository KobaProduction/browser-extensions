<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  compact?: boolean
}>()
</script>

<template>
  <div :class="cn(compact ? 'p-3 pt-0' : 'p-6 pt-0', props.class)">
    <slot />
  </div>
</template>
