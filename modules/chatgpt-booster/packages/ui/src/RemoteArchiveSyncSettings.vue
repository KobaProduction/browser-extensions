<script setup lang="ts">
import type { ChatGptAutomationControl, ChatGptAutomationStatus } from '@chatgpt-booster/core'
import type { RemoteSessionConfig } from '@kobaproduction/browser-core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { LoaderCircle } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{
  configuration: RemoteSessionConfig
  status?: ChatGptAutomationStatus
  control: ChatGptAutomationControl
  disabled?: boolean
}>()
const emit = defineEmits<{ busy: [value: boolean]; refresh: [] }>()
const pending = ref(false),
  error = ref('')
const sync = computed(() => props.status?.sync)
const active = computed(
  () => pending.value || sync.value?.state === 'preparing' || sync.value?.state === 'queuing',
)
const labels = {
  idle: 'Архив ещё не добавлен в очередь',
  preparing: 'Подготавливаем записи',
  queuing: 'Добавляем записи в очередь',
  queued: 'Записи добавлены в очередь',
  cancelled: 'Добавление остановлено',
  failed: 'Не удалось добавить все записи',
} as const
const label = computed(() => (sync.value ? labels[sync.value.state] : labels.idle))
const progress = computed(() => {
  const current = sync.value
  return current?.totalRows && current.totalRows > 0
    ? Math.min(100, (current.queuedRows / current.totalRows) * 100)
    : null
})
const issue = computed(() => {
  if (sync.value?.state !== 'failed') return ''
  const code = sync.value.errorCode
  if (code === 'queue-full')
    return 'Очередь заполнена. Дождитесь освобождения места и повторите отправку архива.'
  if (code === 'backpressure-timeout')
    return 'Сервер не подтвердил пакеты вовремя. Повторите после восстановления доставки.'
  if (code === 'remote-disabled') return 'Включите подключение и выберите внешнюю доставку.'
  if (code === 'owner-unavailable') return 'Дождитесь подтверждения аккаунта и повторите.'
  if (code === 'source-changed')
    return 'Архив изменился во время подготовки. Повторите, чтобы создать новый снимок.'
  return 'Сервер недоступен или очередь не готова. Проверьте подключение и повторите.'
})
let disposed = false
watch(pending, (value) => emit('busy', value), { flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  emit('busy', false)
})
async function start() {
  const control = props.control
  if (
    props.disabled ||
    active.value ||
    !props.status?.verifiedOwner ||
    !props.configuration.enabled ||
    props.configuration.mode === 'local-only'
  )
    return
  pending.value = true
  error.value = ''
  try {
    await control.syncArchive()
  } catch {
    if (
      !disposed &&
      control === props.control &&
      !['failed', 'cancelled'].includes(control.status().sync.state)
    )
      error.value = 'Не удалось добавить архив в очередь. Повторите позже.'
  } finally {
    if (!disposed && control === props.control) emit('refresh')
    pending.value = false
  }
}
function cancel() {
  try {
    props.control.cancelSync()
  } catch {
    error.value = 'Не удалось остановить добавление записей. Повторите позже.'
  }
}
</script>

<template>
  <Card class="min-w-0"><CardHeader class="p-4 pb-3"><CardTitle class="text-base">{{ text('Сохранённый архив') }}</CardTitle><CardDescription>{{ text('Отправка записей этого аккаунта из локального архива. История с сайта не загружается.') }}</CardDescription></CardHeader><CardContent class="space-y-3 p-4 pt-0" :aria-busy="active">
    <div class="min-h-10 space-y-1" role="status"><p class="text-sm font-medium">{{ text(label) }}</p><p v-if="sync && sync.state !== 'idle'" class="text-sm tabular-nums">{{ text('Добавлено в очередь ') }}{{ sync.queuedRows }}{{ text(' записей') }}<span v-if="sync.totalRows !== null">{{ text(' из ') }}{{ sync.totalRows }}</span>.</p></div>
    <Skeleton v-if="sync?.state === 'preparing'" class="h-2 w-full" :aria-label="text('Подготавливаем архив')" />
    <Progress v-else-if="active && progress !== null" :model-value="progress" class="h-2" :aria-label="text('Записи, добавленные в очередь')" />
    <p class="text-xs leading-5 text-muted-foreground">{{ text('Это ещё не подтверждение доставки. Отмена останавливает добавление новых записей; уже добавленные пакеты остаются в очереди. Локальный архив не меняется.') }}</p>
    <Alert v-if="issue || error" variant="destructive"><AlertDescription>{{ text(issue || error) }}{{ text(' Локальные данные сохранены.') }}</AlertDescription></Alert>
    <div class="flex flex-wrap gap-2"><Button size="sm" :disabled="disabled || active || !status?.verifiedOwner || !configuration.enabled || configuration.mode === 'local-only'" @click="start"><LoaderCircle v-if="active" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ active ? text('Добавляем в очередь…') : text('Отправить сохранённый архив') }}</Button><Button v-if="active" variant="outline" size="sm" @click="cancel">{{ text('Остановить добавление') }}</Button></div>
  </CardContent></Card>
</template>
