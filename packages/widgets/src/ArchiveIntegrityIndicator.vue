<script setup lang="ts">
import { Button } from '@kobaproduction/browser-ui'
import { CircleCheck, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import { computed } from 'vue'
import { type ArchiveIntegrityStatusInput, archiveIntegrityStatus } from './archive-integrity-status'

const props = defineProps<ArchiveIntegrityStatusInput & { locale: 'ru' | 'en' }>()
const emit = defineEmits<{ details: [] }>()
const status = computed(() => archiveIntegrityStatus(props))
const text = (ru: string, en: string) => (props.locale === 'ru' ? ru : en)
const label = computed(() => {
  const s = status.value
  if (s.state === 'loading') return text('Проверяем архив…', 'Checking archive…')
  if (s.state === 'error') return text('Не удалось проверить архив', 'Archive check failed')
  if (s.state === 'complete')
    return props.integrity?.scope === 'current-native-graph'
      ? text('Текущая история сохранена', 'Current history saved')
      : text('Архив полный', 'Archive complete')
  const parts: string[] = []
  if (s.missingStart) parts.push(text('Начало не сохранено', 'Start not saved'))
  else if (s.start !== 'verified') parts.push(text('Начало не подтверждено', 'Start unverified'))
  if (s.gaps) parts.push(`${text('Разрывы', 'Gaps')}: ${s.gaps}`)
  else if (s.chain === 'gaps') parts.push(text('Есть разрывы', 'Contains gaps'))
  if (s.missingEnd) parts.push(text('Конец не сохранён', 'End not saved'))
  return parts.length ? parts.join(' · ') : text('Полнота не подтверждена', 'Completeness unverified')
})
const details = computed(() => {
  const s = status.value
  const evidence = (value: string) =>
    value === 'verified'
      ? text('подтверждено', 'verified')
      : value === 'missing'
        ? text('не сохранено', 'not saved')
        : text('не подтверждено', 'unverified')
  return [
    label.value,
    ...(props.integrity?.scope === 'current-native-graph'
      ? [
          text('Проверен полный граф, возвращённый ChatGPT', 'Full graph returned by ChatGPT verified'),
          `${text('Исторических записей вне текущего графа', 'Historical records outside the current graph')}: ${props.integrity.retainedOutsideGraph ?? 0}`,
        ]
      : []),
    `${text('Начало', 'Start')}: ${s.missingStart ? text('не сохранено', 'not saved') : evidence(s.start)}`,
    `${text('Конец', 'End')}: ${evidence(s.end)}`,
    `${text('Связи', 'Links')}: ${evidence(s.chain)}`,
    `${text('Разрывы', 'Gaps')}: ${s.gaps}`,
  ].join('; ')
})
</script>

<template>
  <span role="status" aria-live="polite" aria-atomic="true" class="inline-flex min-w-0" data-archive-integrity :data-state="status.state">
    <Button type="button" variant="ghost" size="sm" class="h-auto min-h-7 max-w-full justify-start gap-1.5 px-1 py-1 text-left text-xs whitespace-normal"
      :class="status.state === 'error' || status.state === 'partial' ? 'text-destructive' : status.state === 'complete' ? 'text-foreground' : 'text-muted-foreground'"
      :title="details" :aria-label="details" :disabled="!integrity || loading || error" @click="emit('details')">
      <LoaderCircle v-if="status.state === 'loading'" class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <CircleCheck v-else-if="status.state === 'complete'" class="size-3.5 shrink-0" aria-hidden="true" />
      <TriangleAlert v-else-if="status.state === 'partial' || status.state === 'error'" class="size-3.5 shrink-0" aria-hidden="true" />
      <CircleHelp v-else class="size-3.5 shrink-0" aria-hidden="true" />
      {{ label }}
    </Button>
  </span>
</template>
