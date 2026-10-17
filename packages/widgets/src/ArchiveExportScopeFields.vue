<script setup lang="ts">
import {
  ARCHIVE_READER_MAX_RECORDS,
  ARCHIVE_READER_PAGE_SIZE,
  type ArchiveExportMessageSummary,
  type ArchiveExportSelection,
  archiveExportSelectionIds,
} from '@kobaproduction/browser-archive'
import {
  Button,
  Checkbox,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  useApplicationLocale,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { createArchiveReadingScroll } from './archive-reading-scroll'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const props = defineProps<{
  modelValue: ArchiveExportSelection
  messages: readonly ArchiveExportMessageSummary[]
  selectedIds: readonly string[]
  disabled?: boolean
  loading?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ArchiveExportSelection]
  'update:selectedIds': [value: readonly string[]]
}>()
const text = useLocalizedText(WIDGET_UI_MESSAGES),
  locale = useApplicationLocale(),
  groupId = useId()
const search = ref(''),
  selectionRoot = ref<HTMLElement | null>(null),
  start = ref(0),
  end = ref(ARCHIVE_READER_PAGE_SIZE)
const modes = [
  { id: 'all', label: 'Все сообщения' },
  { id: 'dates', label: 'За период' },
  { id: 'last', label: 'Последние N' },
  { id: 'selected', label: 'Выбранные' },
] as const
function change(patch: Partial<ArchiveExportSelection>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
function choose(mode: unknown) {
  if (modes.some((item) => item.id === mode)) change({ mode: mode as ArchiveExportSelection['mode'] })
}
const result = computed(() => {
  try {
    const ids = archiveExportSelectionIds(props.messages, props.modelValue, props.selectedIds)
    return { count: ids?.length ?? props.messages.length, error: '' }
  } catch (error) {
    return { count: 0, error: error instanceof Error ? error.message : 'Некорректный диапазон' }
  }
})
const selected = computed(() => new Set(props.selectedIds))
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return props.messages.filter(
    (message) => !term || `${message.author} ${message.text}`.toLocaleLowerCase().includes(term),
  )
})
const visible = computed(() => filtered.value.slice(start.value, end.value))
const viewport = () =>
  selectionRoot.value?.querySelector<HTMLElement>('[data-reka-scroll-area-viewport]') ?? null
const scroll = createArchiveReadingScroll({
  viewport,
  enabled: () => !props.disabled,
  canLoad: (direction) => (direction === 'older' ? start.value > 0 : end.value < filtered.value.length),
  load: async (direction) => {
    const anchor = scroll.capture()
    if (direction === 'older') {
      start.value = Math.max(0, start.value - ARCHIVE_READER_PAGE_SIZE)
      end.value = Math.min(end.value, start.value + ARCHIVE_READER_MAX_RECORDS)
    } else {
      end.value = Math.min(filtered.value.length, end.value + ARCHIVE_READER_PAGE_SIZE)
      start.value = Math.max(0, end.value - ARCHIVE_READER_MAX_RECORDS)
    }
    await nextTick()
    scroll.restore(anchor)
  },
})
watch([search, () => props.messages], () => {
  scroll.reset()
  start.value = 0
  end.value = ARCHIVE_READER_PAGE_SIZE
  void nextTick(() => {
    const v = viewport()
    if (v) v.scrollTop = 0
  })
})
onBeforeUnmount(scroll.reset)
function toggle(id: string, checked: boolean | 'indeterminate') {
  const next = new Set(props.selectedIds)
  if (checked === true) next.add(id)
  else next.delete(id)
  emit('update:selectedIds', [...next])
}
function selectVisible() {
  emit('update:selectedIds', [
    ...new Set([...props.selectedIds, ...visible.value.map((message) => message.id)]),
  ])
}
function date(value: number | null) {
  return value === null ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Number.isNaN(new Date(value).getTime())
    ? ''
    : new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}
function author(message: ArchiveExportMessageSummary) {
  return (
    message.author ||
    text(message.role === 'user' ? 'Вы' : message.role === 'assistant' ? 'Ассистент' : 'Сообщение')
  )
}
</script>
<template>
  <section class="grid min-w-0 gap-3" data-archive-export-scope>
    <p class="m-0 text-sm font-medium">{{ text('Что экспортировать') }}</p>
    <RadioGroup :model-value="modelValue.mode" :disabled="disabled" :aria-label="text('Что экспортировать')" class="grid grid-cols-2 gap-2" @update:model-value="choose">
      <div v-for="mode in modes" :key="mode.id" class="flex items-center gap-2"><RadioGroupItem :id="`${groupId}-${mode.id}`" :value="mode.id" /><Label :for="`${groupId}-${mode.id}`">{{ text(mode.label) }}</Label></div>
    </RadioGroup>
    <div v-if="modelValue.mode==='dates'" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Label class="grid gap-2">{{ text('С даты') }}<Input type="date" :aria-label="text('С даты')" :model-value="modelValue.fromDate" :disabled="disabled" @update:model-value="change({fromDate:String($event)})" /></Label>
      <Label class="grid gap-2">{{ text('По дату включительно') }}<Input type="date" :aria-label="text('По дату включительно')" :model-value="modelValue.throughDate" :disabled="disabled" @update:model-value="change({throughDate:String($event)})" /></Label>
    </div>
    <div v-if="modelValue.mode==='last'" class="grid gap-2">
      <Label class="grid gap-2">{{ text('Количество последних сообщений') }}<Input type="number" min="1" step="1" :aria-label="text('Количество последних сообщений')" :model-value="modelValue.lastCount" :disabled="disabled" @update:model-value="change({lastCount:Number($event)})" /></Label>
      <div class="flex flex-wrap gap-2"><Button v-for="count in [50,100,1000]" :key="count" size="sm" :variant="modelValue.lastCount===count?'secondary':'outline'" :aria-pressed="modelValue.lastCount===count" :disabled="disabled" @click="change({lastCount:count})">{{ count }}</Button></div>
    </div>
    <div v-if="modelValue.mode==='selected'" ref="selectionRoot" class="grid min-w-0 gap-2" @scroll.capture="scroll.onScroll" @wheel.passive="scroll.onUserInput" @touchmove.passive="scroll.onUserInput" @pointerdown="scroll.onUserInput" @pointermove.passive="scroll.onUserInput" @keydown="scroll.onUserInput">
      <Input v-model="search" :placeholder="text('Поиск сообщений')" :aria-label="text('Поиск сообщений')" :disabled="disabled" />
      <div class="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" :disabled="disabled||!visible.length" @click="selectVisible">{{ text('Выбрать показанные') }}</Button><Button size="sm" variant="ghost" :disabled="disabled||!selectedIds.length" @click="emit('update:selectedIds',[])">{{ text('Очистить выбор') }}</Button><span class="text-xs text-muted-foreground">{{ text('Выбрано:') }} {{ selectedIds.length }}</span></div>
      <ScrollArea class="h-64 min-w-0 rounded-md border border-border">
        <div class="grid gap-1 p-2"><div v-for="message in visible" :key="message.id" :data-archive-node="message.id" class="flex min-w-0 items-start gap-3 rounded-md p-2" :class="selected.has(message.id)?'bg-muted':''">
          <Checkbox class="mt-1 shrink-0" :model-value="selected.has(message.id)" :aria-label="`${text('Выбрать сообщение:')} ${author(message)} · ${message.text}`" :disabled="disabled" @update:model-value="toggle(message.id,$event)" />
          <div class="min-w-0 text-sm"><div class="flex flex-wrap gap-x-2 gap-y-1"><strong>{{ author(message) }}</strong><time v-if="date(message.timestampMs)" :datetime="new Date(message.timestampMs ?? 0).toISOString()" class="text-xs text-muted-foreground">{{ date(message.timestampMs) }}</time></div><p class="m-0 whitespace-pre-wrap break-words">{{ message.text||text('Сообщение без текста') }}</p></div>
        </div><p v-if="!visible.length&&!loading" class="p-2 text-sm text-muted-foreground">{{ text('Сообщения не найдены') }}</p></div>
      </ScrollArea>
    </div>
    <p v-if="loading" role="status" class="text-xs text-muted-foreground">{{ text('Загружаем список сообщений…') }}</p>
    <p v-else-if="result.error" role="alert" class="text-xs text-destructive">{{ text(result.error) }}</p>
    <p v-else role="status" class="text-xs text-muted-foreground">{{ text('Сообщений в экспорте:') }} {{ result.count }}</p>
    <p v-if="(modelValue.mode==='dates'||modelValue.mode==='last')&&messages.some(message=>message.timestampMs===null)" class="text-xs text-muted-foreground">{{ text('Без даты, исключены из фильтра:') }} {{ messages.filter(message=>message.timestampMs===null).length }}</p>
  </section>
</template>
