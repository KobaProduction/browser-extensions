<script setup lang="ts">
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kobaproduction/browser-ui'
import { Archive, ChevronDown, Download, FolderOpen, Pause, Play } from 'lucide-vue-next'
import { computed, ref, useId } from 'vue'
import ArchiveProgressBar from './ArchiveProgressBar.vue'
import type { ArchiveManagerMode, ArchiveManagerOptions, ArchiveManagerState } from './types'

const props = defineProps<{
  state: ArchiveManagerState
  initial: ArchiveManagerOptions
  error?: string
  title?: string
}>()
const emit = defineEmits<{
  (event: 'choose-folder'): void
  (event: 'start', options: ArchiveManagerOptions): void
  (event: 'stop'): void
  (event: 'resume'): void
}>()
const fieldId = useId()
const mode = ref<ArchiveManagerMode>(props.initial.mode)
const limit = ref<string | number>(props.initial.limit)
const from = ref(props.initial.from),
  through = ref(props.initial.through)
const pageSize = ref<string | number>(props.initial.pageSize)
const delay = ref<string | number>(props.initial.delay)
const media = ref(props.initial.media)
const advanced = ref(false)
const percent = computed(() => {
  if (Number.isFinite(props.state.total) && props.state.total > 0 && Number.isFinite(props.state.done))
    return Math.min(100, Math.max(0, Math.floor((props.state.done / props.state.total) * 100)))
  return props.state.busy ? null : props.state.phase === 'Готово' ? 100 : 0
})
const inputError = computed(() => {
  const count = Number(limit.value),
    batch = Number(pageSize.value),
    pause = Number(delay.value)
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
    return 'Количество сообщений: от 1 до 100 000.'
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 100) return 'Размер пачки: от 1 до 100.'
  if (!Number.isFinite(pause) || pause < 300) return 'Пауза между пачками: от 300 мс.'
  if (from.value && through.value && from.value > through.value)
    return 'Начало диапазона должно быть не позднее его окончания.'
  return ''
})
const busy = computed(() => props.state.busy || !!props.state.folderPending)
const canStart = computed(
  () => !busy.value && !!props.state.folder && !props.state.blockedReason && !inputError.value,
)
function selectMode(value: unknown) {
  if (value === 'recent' || value === 'incremental' || value === 'backfill') mode.value = value
}
function start() {
  if (!canStart.value) return
  emit('start', {
    mode: mode.value,
    limit: Number(limit.value),
    from: from.value,
    through: through.value,
    pageSize: Number(pageSize.value),
    delay: Number(delay.value),
    media: media.value,
  })
}
</script>
<template>
  <div class="grid min-w-0 gap-4">
    <Card>
      <CardHeader class="flex-row items-start justify-between gap-3 p-4">
        <div class="grid min-w-0 gap-2">
          <CardTitle class="flex flex-wrap items-center gap-2 text-base"><Archive class="size-4" />{{ title || 'Архив переписки' }}<Badge :variant="state.busy ? 'default' : 'outline'">{{ state.folderPending ? 'Выбор папки' : state.busy ? 'Экспорт' : 'Ожидание' }}</Badge></CardTitle>
          <CardDescription>{{ state.context }} · Сообщений в архиве: {{ state.messages }}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" :disabled="busy" @click="emit('choose-folder')"><FolderOpen class="size-4" />Папка</Button>
      </CardHeader>
      <CardContent class="grid gap-1 px-4 pb-4 text-sm"><span class="font-medium">Хранилище</span><span class="break-all text-muted-foreground">{{ state.folder || 'Выберите папку архива' }}</span></CardContent>
    </Card>
    <Card>
      <CardHeader class="p-4"><CardTitle class="text-base">Что выгружать</CardTitle><CardDescription>Без дублирования уже сохранённых сообщений</CardDescription></CardHeader>
      <CardContent class="grid gap-4 px-4 pb-4">
        <div class="grid gap-3 min-[621px]:grid-cols-2">
          <div class="grid gap-2"><Label :for="`${fieldId}-mode`">Режим</Label><Select :model-value="mode" :disabled="busy" @update:model-value="selectMode"><SelectTrigger :id="`${fieldId}-mode`" class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">Последние N</SelectItem><SelectItem value="incremental">Только новые</SelectItem><SelectItem value="backfill">Продолжить старые</SelectItem></SelectContent></Select></div>
          <div class="grid gap-2"><Label :for="`${fieldId}-limit`">Количество сообщений</Label><Input :id="`${fieldId}-limit`" v-model="limit" type="number" min="1" max="100000" :disabled="busy" /></div>
        </div>
        <Collapsible v-model:open="advanced">
          <CollapsibleTrigger as-child><Button type="button" variant="ghost" class="h-auto w-full justify-between whitespace-normal px-0 text-left"><span class="grid gap-0.5"><span>Дополнительные настройки</span><small class="font-normal text-muted-foreground">Диапазон дат, пачка и медиафайлы</small></span><ChevronDown class="size-4 shrink-0 transition-transform" :class="{ 'rotate-180': advanced }" /></Button></CollapsibleTrigger>
          <CollapsibleContent class="grid gap-3 pt-3 min-[621px]:grid-cols-2">
            <div class="grid gap-2"><Label :for="`${fieldId}-from`">С даты</Label><Input :id="`${fieldId}-from`" :model-value="from" type="date" :disabled="busy" @update:model-value="from = String($event)" /></div>
            <div class="grid gap-2"><Label :for="`${fieldId}-through`">По дату</Label><Input :id="`${fieldId}-through`" :model-value="through" type="date" :disabled="busy" @update:model-value="through = String($event)" /></div>
            <div class="grid gap-2"><Label :for="`${fieldId}-batch`">Пачка</Label><Input :id="`${fieldId}-batch`" v-model="pageSize" type="number" min="1" max="100" :disabled="busy" /></div>
            <div class="grid gap-2"><Label :for="`${fieldId}-delay`">Пауза, мс</Label><Input :id="`${fieldId}-delay`" v-model="delay" type="number" min="300" :disabled="busy" /></div>
            <div class="flex items-start gap-3 min-[621px]:col-span-2"><Checkbox :id="`${fieldId}-media`" class="mt-0.5" :model-value="media" :disabled="busy" @update:model-value="media = $event === true" /><Label :for="`${fieldId}-media`">Сохранять файлы и голосовые</Label></div>
          </CollapsibleContent>
        </Collapsible>
        <Alert v-if="inputError" variant="destructive"><AlertDescription>{{ inputError }}</AlertDescription></Alert>
      </CardContent>
    </Card>
    <Card>
      <CardHeader class="p-4"><CardTitle class="text-base">Прогресс экспорта</CardTitle><CardDescription role="status">{{ state.error || state.phase || 'Ожидание' }}</CardDescription></CardHeader>
      <CardContent class="grid gap-4 px-4 pb-4">
        <ArchiveProgressBar label="Прогресс экспорта" :percent="percent" compact />
        <div class="grid grid-cols-2 gap-2 text-xs min-[900px]:grid-cols-4"><span>Обработано <b>{{ state.done }} / {{ state.total }}</b></span><span>Новых <b>{{ state.newCount }}</b></span><span>Файлов <b>{{ state.downloaded }}</b></span><span>Ошибки <b>{{ state.failed }}</b></span></div>
        <div class="flex flex-wrap gap-2"><Button type="button" :disabled="!canStart" @click="start"><Download class="size-4" />Выгрузить</Button><Button type="button" variant="outline" :disabled="!state.busy || state.folderPending" @click="emit('stop')"><Pause class="size-4" />Пауза</Button><Button type="button" variant="outline" :disabled="busy || !state.paused || !!state.blockedReason" @click="emit('resume')"><Play class="size-4" />Продолжить</Button></div>
        <Alert v-if="state.blockedReason || error" variant="destructive"><AlertDescription>{{ state.blockedReason || error }}</AlertDescription></Alert>
      </CardContent>
    </Card>
  </div>
</template>
