<script setup lang="ts">
import type { ChatGptAutomationControl, ChatGptAutomationStatus } from '@chatgpt-booster/core'
import type { RemoteSessionConfig } from '@kobaproduction/browser-core'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  useApplicationLocale,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { ChevronDown, LoaderCircle } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const locale = useApplicationLocale()
const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{
  configuration: RemoteSessionConfig
  status?: ChatGptAutomationStatus
  control?: ChatGptAutomationControl
  disabled?: boolean
}>()
const emit = defineEmits<{
  patch: [value: Partial<RemoteSessionConfig>]
  busy: [value: boolean]
  refresh: []
}>()
const id = useId(),
  error = ref(''),
  notice = ref('')
const operation = ref<'reconnect' | 'retry' | null>(null)
const queueLimit = ref<string | number>(props.configuration.queueLimit),
  maxAttempts = ref<string | number>(props.configuration.maxAttempts)
const remote = computed(() => props.status?.remote)
const labels = {
  disabled: 'Подключение выключено',
  offline: 'Нет соединения',
  connecting: 'Подключаемся',
  authenticating: 'Проверяем доступ',
  online: 'Соединение установлено',
  backoff: 'Ожидаем повторного подключения',
} as const
const connectionLabel = computed(() =>
  remote.value ? labels[remote.value.state] : 'Соединение не запущено',
)
const issue = computed(() => {
  const code = remote.value?.errorCode
  if (!code) return ''
  if (code === 'authentication-required') return 'Для подключения сохраните токен доступа.'
  if (code === 'queue-full') return 'Очередь заполнена. Дождитесь подтверждения доставки.'
  if (code === 'reconnect-limit') return 'Автоматические попытки закончились. Переподключитесь вручную.'
  if (code === 'durable-outbox-required' || code === 'outbox-unavailable')
    return 'Локальная очередь недоступна. Надёжная доставка пока невозможна.'
  if (code === 'configuration-unavailable')
    return 'Не удалось подготовить соединение. Проверьте адрес и токен.'
  if (code === 'enqueue-failed') return 'Не удалось добавить пакет в очередь.'
  if (code === 'protocol-error') return 'Ответ сервера не соответствует протоколу обмена.'
  return 'Сервер недоступен или соединение прервано.'
})
const nextReconnect = computed(() => {
  const at = remote.value?.nextReconnectAt
  return typeof at === 'number' && Number.isFinite(at) && at > 0
    ? new Date(at).toLocaleTimeString(locale.value)
    : ''
})
let disposed = false
watch(operation, (value) => emit('busy', value !== null), { flush: 'sync' })
watch(
  () => props.configuration.queueLimit,
  (value) => {
    queueLimit.value = value
  },
)
watch(
  () => props.configuration.maxAttempts,
  (value) => {
    maxAttempts.value = value
  },
)
onBeforeUnmount(() => {
  disposed = true
  emit('busy', false)
})
function saveLimit(field: 'queueLimit' | 'maxAttempts', event?: Event) {
  const draft =
    (event?.target as HTMLInputElement | null)?.value ??
    (field === 'queueLimit' ? queueLimit.value : maxAttempts.value)
  const value = Number(draft),
    maximum = field === 'queueLimit' ? 100000 : 32
  if (String(draft).trim() === '' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    error.value = `${text('Укажите целое число от 1 до')} ${maximum}.`
    return
  }
  error.value = ''
  if (value !== props.configuration[field]) emit('patch', { [field]: value })
}
async function run(kind: 'reconnect' | 'retry') {
  const control = props.control
  if (!control || props.disabled || operation.value) return
  operation.value = kind
  error.value = ''
  notice.value = ''
  try {
    if (kind === 'reconnect') await control.reconnect()
    else await control.retryPending()
    if (disposed || control !== props.control) return
    emit('refresh')
    if (kind === 'retry')
      notice.value = 'Пакеты возвращены в очередь. Отправка продолжится при подключении.'
  } catch {
    if (!disposed)
      error.value =
        kind === 'reconnect'
          ? 'Не удалось переподключиться. Проверьте адрес, токен и доступность сети.'
          : 'Не удалось вернуть пакеты в очередь. Повторите позже.'
  } finally {
    operation.value = null
  }
}
</script>

<template>
  <Card class="min-w-0"><CardHeader class="p-4 pb-3"><CardTitle class="text-base">{{ text('Доставка') }}</CardTitle><CardDescription>{{ text('Получение пакетов подтверждает сервер. Локальный архив хранится по своим настройкам.') }}</CardDescription></CardHeader><CardContent class="space-y-3 p-4 pt-0" :aria-busy="operation !== null">
    <Alert v-if="configuration.enabled && configuration.mode === 'remote-only'"><AlertDescription>{{ text('Новые сообщения не сохраняются локально. Очередь остаётся в памяти страницы и теряется при её закрытии.') }}</AlertDescription></Alert>
    <p v-else-if="configuration.enabled && configuration.mode === 'local-and-remote'" class="text-xs leading-5 text-muted-foreground">{{ text('Неотправленные пакеты остаются локально до подтверждения сервера.') }}</p>
    <p v-else class="text-xs leading-5 text-muted-foreground">{{ text('Внешняя доставка выключена.') }}</p>
    <p v-if="!control" class="text-sm text-muted-foreground">{{ text('В этом просмотре соединение не запускается.') }}</p>
    <template v-else>
      <div class="flex min-w-0 flex-wrap items-center gap-2" role="status"><Badge :variant="remote?.state === 'online' ? 'default' : 'secondary'">{{ text(connectionLabel) }}</Badge><span class="text-xs text-muted-foreground">{{ status?.verifiedOwner ? text('Аккаунт подтверждён') : text('Ожидаем подтверждение аккаунта') }}</span></div>
      <dl v-if="remote" class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted-foreground">{{ text('В очереди') }}</dt><dd class="text-right tabular-nums">{{ remote.queued }}</dd>
        <dt class="text-muted-foreground">{{ text('Ожидают подтверждения') }}</dt><dd class="text-right tabular-nums">{{ remote.inFlight }}</dd>
        <dt class="text-muted-foreground">{{ text('Требуют ручного повтора') }}</dt><dd class="text-right tabular-nums">{{ remote.deadLetter }}</dd>
        <dt class="text-muted-foreground">{{ text('Хранение очереди') }}</dt><dd class="max-w-36 break-words text-right">{{ remote.mode === 'local-only' ? text('Доставка выключена') : remote.durable ? text('Локально') : text('В памяти страницы') }}</dd>
      </dl>
      <p v-if="nextReconnect" class="text-xs text-muted-foreground">{{ text('Следующая попытка: ') }}{{ nextReconnect }}</p>
      <Alert v-if="issue"><AlertDescription>{{ text(issue) }}</AlertDescription></Alert>
      <div class="flex flex-wrap gap-2"><Button variant="outline" size="sm" :disabled="disabled || !configuration.enabled || configuration.mode === 'local-only' || !status?.verifiedOwner" @click="run('reconnect')"><LoaderCircle v-if="operation === 'reconnect'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ operation === 'reconnect' ? text('Переподключаемся…') : text('Переподключиться') }}</Button><Button v-if="remote?.deadLetter" variant="outline" size="sm" :disabled="disabled || !status?.verifiedOwner" @click="run('retry')"><LoaderCircle v-if="operation === 'retry'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ text('Повторить отложенные пакеты') }}</Button></div>
    </template>
    <Collapsible class="border-t pt-2"><CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="group h-auto min-h-9 w-full justify-between gap-3 whitespace-normal text-left"><span>{{ text('Параметры очереди') }}</span><ChevronDown class="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent class="space-y-3 pt-3">
      <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2"><div class="grid gap-2"><Label :for="`${id}-queue`">{{ text('Максимум пакетов') }}</Label><Input :id="`${id}-queue`" v-model="queueLimit" :disabled="disabled" type="number" min="1" max="100000" step="1" @change="saveLimit('queueLimit', $event)" /></div><div class="grid gap-2"><Label :for="`${id}-attempts`">{{ text('Попыток до ручного повтора') }}</Label><Input :id="`${id}-attempts`" v-model="maxAttempts" :disabled="disabled" type="number" min="1" max="32" step="1" @change="saveLimit('maxAttempts', $event)" /></div></div>
      <p class="text-xs leading-5 text-muted-foreground">{{ text('Целые значения применяются после выхода из поля. Исчерпавшие попытки пакеты остаются для ручного повтора.') }}</p>
    </CollapsibleContent></Collapsible>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ text(error) }}</AlertDescription></Alert><p v-if="notice" role="status" class="text-sm">{{ text(notice) }}</p>
  </CardContent></Card>
</template>
