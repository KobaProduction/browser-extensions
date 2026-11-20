<script setup lang="ts">
import Tooltip from './Tooltip.vue'
import TooltipContent from './TooltipContent.vue'
import TooltipProvider from './TooltipProvider.vue'
import TooltipTrigger from './TooltipTrigger.vue'

defineProps<{ label: string }>()
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <Tooltip>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipContent :side-offset="8" :collision-padding="8"
        class="booster-floating-tooltip max-w-[min(320px,calc(100vw-16px))] whitespace-pre-line [overflow-wrap:anywhere]">
        {{ label }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
