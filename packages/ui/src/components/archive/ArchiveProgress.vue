<script setup lang="ts">
import { computed } from 'vue'

/** Source-independent archive/backup/export progress. Neither engine nor
 * provider localization is owned by a shared presentation primitive. */
const props = withDefaults(
  defineProps<{
    label: string
    completed?: number | null
    total?: number | null
    detail?: string | null
    error?: string | null
    busy?: boolean
    ariaLabel?: string
  }>(),
  { completed: null, total: null, detail: null, error: null, busy: false },
)
const progress = computed(() => {
  if (
    props.completed === null ||
    props.completed === undefined ||
    props.total === null ||
    props.total === undefined ||
    !Number.isFinite(props.completed) ||
    !Number.isFinite(props.total) ||
    props.total <= 0
  )
    return null
  return Math.min(100, Math.max(0, Math.floor((props.completed / props.total) * 100)))
})
</script>
<template>
  <section class="booster-shared-archive-progress" :aria-busy="busy">
    <div class="flex items-center justify-between gap-2">
      <span role="status" aria-live="polite">{{ label }}</span>
      <strong v-if="progress !== null" class="tabular-nums">{{ progress }}%</strong>
    </div>
    <progress class="w-full" :value="progress ?? undefined" max="100" :aria-label="ariaLabel || label" />
    <p v-if="detail" class="text-xs text-muted-foreground">{{ detail }}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <slot />
  </section>
</template>
