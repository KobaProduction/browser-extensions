<script setup lang="ts">
defineProps<{ timelineVisible: boolean }>()
</script>

<template>
  <div class="archive-reading-surface relative grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden" :class="timelineVisible ? 'grid-cols-[minmax(0,1fr)_80px] gap-2' : 'grid-cols-1'" data-archive-reading-surface>
    <div class="archive-reading-transcript h-full min-h-0 min-w-0 overflow-hidden" data-archive-reading-transcript><slot /></div>
    <div v-if="timelineVisible" class="archive-reading-timeline min-h-0 min-w-0 overflow-hidden" data-archive-reading-timeline><slot name="timeline" /></div>
    <slot name="status" />
  </div>
</template>
