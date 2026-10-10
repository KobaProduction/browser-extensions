<script setup lang="ts">
/** Presentation only; null percentage means indeterminate rather than invented progress. */
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
  <div :class="compact ? 'w-full' : 'booster-export-progress'">
    <p v-if="!compact" role="status" aria-live="polite">{{ label }}</p>
    <progress :class="compact ? 'w-full' : undefined" :value="percent ?? undefined" max="100" :aria-label="label"/>
    <p v-if="counter" class="booster-note">{{ counter }}<template v-if="percent !== null && percentLabel"> · {{ percentLabel }} {{ percent }}%</template></p>
  </div>
</template>
