<script setup lang="ts">
import { Button, TooltipHint } from '@kobaproduction/browser-ui'
import { ArrowDownToLine, ArrowUpToLine, ChevronsLeft, ChevronsRight } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    firstLabel: string
    lastLabel: string
    firstHint?: string
    lastHint?: string
    disabled?: boolean
    compact?: boolean
    vertical?: boolean
  }>(),
  { compact: true },
)
const emit = defineEmits<{ first: []; last: [] }>()
</script>
<template>
  <div class="contents" data-archive-reader-navigation>
    <TooltipHint :label="firstHint || firstLabel"><Button data-archive-reader-edge="first" :variant="compact ? 'ghost' : 'outline'" :size="compact ? 'icon-sm' : 'sm'" :class="{ 'size-7': compact && vertical }" :aria-label="firstLabel" :disabled="disabled" @click="emit('first')"><component :is="vertical ? ArrowUpToLine : ChevronsLeft" v-if="compact" class="size-4" /><span :class="compact ? 'sr-only' : ''">{{ firstLabel }}</span></Button></TooltipHint>
    <slot />
    <TooltipHint :label="lastHint || lastLabel"><Button data-archive-reader-edge="last" :variant="compact ? 'ghost' : 'outline'" :size="compact ? 'icon-sm' : 'sm'" :class="{ 'size-7': compact && vertical }" :aria-label="lastLabel" :disabled="disabled" @click="emit('last')"><component :is="vertical ? ArrowDownToLine : ChevronsRight" v-if="compact" class="size-4" /><span :class="compact ? 'sr-only' : ''">{{ lastLabel }}</span></Button></TooltipHint>
  </div>
</template>
