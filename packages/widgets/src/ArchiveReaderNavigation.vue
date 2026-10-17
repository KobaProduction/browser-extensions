<script setup lang="ts">
import { Button } from '@kobaproduction/browser-ui'
import { ChevronsLeft, ChevronsRight } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    firstLabel: string
    lastLabel: string
    disabled?: boolean
    compact?: boolean
  }>(),
  { compact: true },
)
const emit = defineEmits<{ first: []; last: [] }>()
</script>
<template>
  <div class="contents" data-archive-reader-navigation>
    <Button data-archive-reader-edge="first" :variant="compact ? 'ghost' : 'outline'" :size="compact ? 'icon-sm' : 'sm'" :aria-label="firstLabel" :title="firstLabel" :disabled="disabled" @click="emit('first')"><ChevronsLeft v-if="compact" class="size-4" /><span :class="compact ? 'sr-only' : ''">{{ firstLabel }}</span></Button>
    <slot />
    <Button data-archive-reader-edge="last" :variant="compact ? 'ghost' : 'outline'" :size="compact ? 'icon-sm' : 'sm'" :aria-label="lastLabel" :title="lastLabel" :disabled="disabled" @click="emit('last')"><ChevronsRight v-if="compact" class="size-4" /><span :class="compact ? 'sr-only' : ''">{{ lastLabel }}</span></Button>
  </div>
</template>
