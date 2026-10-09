<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

defineProps<{
  variant?: 'default' | 'secondary' | 'outline'
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4',
        !variant || variant === 'default'
          ? 'border-transparent bg-primary text-primary-foreground'
          : variant === 'secondary'
            ? 'border-transparent bg-secondary text-secondary-foreground'
            : 'border-border text-foreground',
        $props.class,
      )
    "
  >
    <slot />
  </span>
</template>
