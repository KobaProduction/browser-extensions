<script setup lang="ts">
import {
  APPLICATION_TELEMETRY,
  type ApplicationTelemetryConfiguration,
  type ApplicationTelemetryController,
  type ApplicationTelemetryRecord,
  type ApplicationTelemetryStatus,
  type TelemetryProviderId,
} from '@kobaproduction/browser-core'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useApplicationLocale,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { computed, inject, onMounted, onUnmounted, ref, useId } from 'vue'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const locale = useApplicationLocale()
const text = useLocalizedText(WIDGET_UI_MESSAGES)

const controller = inject<ApplicationTelemetryController | null>(APPLICATION_TELEMETRY, null)
const state = ref<ApplicationTelemetryStatus | null>(null)
const configuration = ref<ApplicationTelemetryConfiguration | null>(null)
const draft = ref<ApplicationTelemetryConfiguration | null>(null)
const view = ref<'local' | 'external' | 'journal'>('local')
const provider = ref<TelemetryProviderId | ''>('')
const records = ref<readonly ApplicationTelemetryRecord[]>([])
const busy = ref(false)
const error = ref('')
const notice = ref('')
const confirmClear = ref(false)
const more = ref(false)
const verifiedEndpoint = ref('')
const checkingEndpoint = ref(false)
const fieldId = useId()
let cleanup: (() => void) | undefined
let poll: ReturnType<typeof setInterval> | undefined
let scheduledRefresh: ReturnType<typeof setTimeout> | undefined
let disposed = false
let refreshSequence = 0
let recordsSequence = 0
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(configuration.value))
const canProbeEndpoint = computed(
  () =>
    !busy.value &&
    Boolean(draft.value?.endpoint && state.value?.remoteAvailable && controller?.probeEndpoint),
)
const canSaveEndpoint = computed(() => {
  const next = draft.value
  if (!next) return false
  return (
    !busy.value &&
    dirty.value &&
    (!next.endpoint ||
      next.endpoint === configuration.value?.endpoint ||
      verifiedEndpoint.value === next.endpoint)
  )
})
const providerLabel = (id: string) =>
  id === 'vk-booster' ? 'VK Booster' : id === 'chatgpt-booster' ? 'ChatGPT Booster' : 'Общее приложение'
const deliveryLabel = computed(
  () =>
    ({
      off: 'Внешняя отправка выключена',
      idle: 'Готова к отправке',
      sending: 'Отправляется пакет',
      offline: 'Нет сети — события остаются локально',
      retrying: 'Endpoint недоступен — повторим позже',
      'permission-required': 'Нужно разрешение браузера для endpoint',
      unavailable: 'Сервис недоступен',
      'collector-rejected':
        'Коллектор отклонил пакет. Журнал сохранён; исправьте endpoint и явно разрешите отправку снова.',
    })[state.value?.deliveryState ?? 'off'],
)
const eventLabel = (name: string) =>
  (
    ({
      'feature.started': 'Модуль запущен',
      'feature.stopped': 'Модуль остановлен',
      'feature.failed': 'Ошибка модуля',
      'application.notification': 'Техническое уведомление',
      'application.error': 'Ошибка приложения',
      'archive.capture.started': 'Сбор начат',
      'archive.capture.completed': 'Сбор завершён',
      'archive.capture.failed': 'Ошибка сбора',
      'archive.export.completed': 'Экспорт завершён',
      'archive.export.failed': 'Ошибка экспорта',
      'archive.audit.completed': 'Проверка завершена',
      'archive.backup.completed': 'Резервная копия создана',
      'archive.restore.completed': 'Восстановление завершено',
    }) as Record<string, string>
  )[name] ?? name
const date = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleString(locale.value) : '—'
async function loadRecords(append = false) {
  if (!controller) return
  const sequence = ++recordsSequence
  const beforeId = append ? records.value.at(-1)?.id : undefined
  const next = await controller.records({
    ...(provider.value ? { providerId: provider.value } : {}),
    beforeId,
    limit: 50,
  })
  if (disposed || sequence !== recordsSequence) return
  records.value = append ? [...records.value, ...next] : next
  more.value = next.length === 50
}
async function refresh(loadConfiguration = false, reloadJournal = true) {
  if (!controller) return
  const sequence = ++refreshSequence
  try {
    const next = await controller.status()
    if (disposed || sequence !== refreshSequence) return
    state.value = next
    if (next.available && (loadConfiguration || !configuration.value)) {
      const config = await controller.configuration()
      if (disposed || sequence !== refreshSequence) return
      configuration.value = config
      if (loadConfiguration || !draft.value) draft.value = { ...config }
    }
    if (next.available && view.value === 'journal' && reloadJournal) await loadRecords()
  } catch {
    if (!disposed) error.value = 'Не удалось прочитать локальную телеметрию.'
  }
}
async function act(work: () => Promise<unknown>, message = '', reloadJournal = true) {
  if (!controller || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
    if (!disposed) notice.value = message
    await refresh(false, reloadJournal)
  } catch (reason) {
    if (!disposed)
      error.value = reason instanceof Error ? reason.message : 'Не удалось выполнить действие.'
  } finally {
    busy.value = false
  }
}
function save() {
  if (!controller || !draft.value) return
  const next = { ...draft.value }
  if (
    next.endpoint &&
    next.endpoint !== configuration.value?.endpoint &&
    verifiedEndpoint.value !== next.endpoint
  ) {
    error.value = 'Сначала проверьте новый endpoint.'
    return
  }
  void act(async () => {
    await controller.configure(next)
    await refresh(true)
  }, 'Параметры сохранены. Ротация выполняется пакетно по расписанию.')
}
function toggleLocal(enabled: boolean) {
  if (controller) void act(() => controller.setLocalEnabled(enabled))
}
function toggleRemote(enabled: boolean) {
  if (controller) void act(() => controller.setRemoteEnabled(enabled))
}
function selectView(next: unknown) {
  if (next !== 'local' && next !== 'external' && next !== 'journal') return
  view.value = next
  error.value = ''
  notice.value = ''
  confirmClear.value = false
  if (next === 'journal') void act(() => loadRecords())
}
function selectProvider(next: unknown) {
  if (
    typeof next !== 'string' ||
    (next !== 'all' && !state.value?.providers.includes(next as TelemetryProviderId))
  )
    return
  provider.value = next === 'all' ? '' : (next as TelemetryProviderId)
  confirmClear.value = false
  void act(() => loadRecords())
}
function updateRetention(key: 'maxEvents' | 'maxAgeDays' | 'rotationMinutes', value: string | number) {
  if (draft.value) draft.value[key] = Number(value)
}
function updateEndpoint(value: string | number) {
  if (draft.value) draft.value.endpoint = String(value)
  verifiedEndpoint.value = ''
  notice.value = ''
}
async function probeEndpoint() {
  if (busy.value || !controller?.probeEndpoint || !draft.value) return
  const activeController = controller
  const probe = controller.probeEndpoint
  const candidate = draft.value.endpoint
  checkingEndpoint.value = true
  try {
    await act(
      async () => {
        const result = await probe.call(activeController, candidate)
        const currentDraft = draft.value
        if (disposed || !currentDraft || currentDraft.endpoint !== candidate) return
        if (!result.ok)
          throw Error(
            {
              unavailable: 'В этой установке нет внешнего транспорта.',
              permission: 'Разрешение браузера для endpoint не предоставлено.',
              configuration: 'Нужен HTTPS адрес без логина, пароля, query и fragment.',
              network: 'Не удалось подключиться. Проверьте сеть, CORS и адрес коллектора.',
              rejected: 'Endpoint не подтвердил приём OTLP. Проверьте адрес и конфигурацию коллектора.',
            }[result.errorCode ?? 'rejected'],
          )
        currentDraft.endpoint = result.endpoint
        verifiedEndpoint.value = result.endpoint
      },
      'Endpoint проверен пустым OTLP-запросом. События журнала не отправлялись.',
      false,
    )
  } finally {
    checkingEndpoint.value = false
  }
}
function removeEndpoint() {
  if (!controller || !configuration.value) return
  const activeController = controller
  const currentConfiguration = configuration.value
  void act(
    async () => {
      await activeController.setRemoteEnabled(false)
      await activeController.configure({ ...currentConfiguration, endpoint: '', remoteEnabled: false })
      configuration.value = await activeController.configuration()
      if (draft.value) draft.value = { ...draft.value, endpoint: '', remoteEnabled: false }
      verifiedEndpoint.value = ''
    },
    'Endpoint удалён, внешняя отправка выключена.',
    false,
  )
}
function flushQueue() {
  if (controller) void act(() => controller.flush())
}
function clearJournal() {
  if (!controller) return
  void act(async () => {
    await controller.clearRecords()
    confirmClear.value = false
  })
}
function exportJournal() {
  if (!controller) return
  void act(async () => {
    const content = await controller.exportRecords(provider.value || undefined)
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'browser-tools-telemetry.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'Локальный журнал сохранён в JSON.')
}
function queueRefresh() {
  if (disposed || busy.value || scheduledRefresh !== undefined) return
  scheduledRefresh = setTimeout(() => {
    scheduledRefresh = undefined
    if (!disposed && !busy.value)
      void refresh(false, view.value === 'journal' && records.value.length <= 50)
  }, 250)
}
onMounted(() => {
  cleanup = controller?.subscribe(queueRefresh)
  poll = setInterval(queueRefresh, 5000)
  void refresh(true)
})
onUnmounted(() => {
  disposed = true
  cleanup?.()
  if (poll !== undefined) clearInterval(poll)
  if (scheduledRefresh !== undefined) clearTimeout(scheduledRefresh)
})
</script>

<template>
  <section class="grid min-w-0 gap-4" :aria-label="text('Телеметрия приложения')" :aria-busy="busy">
    <div class="space-y-1">
      <h3 class="text-base font-semibold">{{ text('Телеметрия') }}</h3>
      <p class="text-sm text-muted-foreground">{{ text('Общий журнал технических событий VK, ChatGPT и приложения. Текст сообщений, аккаунты, адреса страниц и токены в него не попадают.') }}</p>
    </div>
    <p v-if="!controller || state?.available === false" class="text-sm text-muted-foreground">{{ text('Сервис недоступен в этой установке.') }}</p>
    <div v-else-if="!state" class="grid gap-3" role="status" :aria-label="text('Загрузка телеметрии')"><Skeleton class="h-9 w-full" /><Skeleton class="h-32 w-full" /></div>
    <Tabs v-else :model-value="view" class="min-w-0" @update:model-value="selectView">
      <TabsList class="grid w-full min-w-0 grid-cols-3" :aria-label="text('Разделы телеметрии')">
        <TabsTrigger value="local" :disabled="busy" class="min-w-0">{{ text('Сбор') }}</TabsTrigger>
        <TabsTrigger value="external" :disabled="busy" class="min-w-0">{{ text('Отправка') }}</TabsTrigger>
        <TabsTrigger value="journal" :disabled="busy" class="min-w-0">{{ text('Журнал') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="local" class="space-y-4">
        <Card>
          <CardHeader class="p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 space-y-1.5">
                <Label :for="`${fieldId}-local`" class="text-base font-semibold">{{ text('Собирать события локально') }}</Label>
                <CardDescription>{{ text('По умолчанию выключено. Отключение останавливает сбор и отправку, сохранённый журнал остаётся доступен.') }}</CardDescription>
              </div>
              <Switch :id="`${fieldId}-local`" :model-value="state?.localEnabled ?? false" :disabled="busy || !state" @update:model-value="toggleLocal" />
            </div>
          </CardHeader>
          <CardContent class="p-4 pt-0">
            <dl class="grid grid-cols-2 gap-4 text-sm">
              <div><dt class="text-muted-foreground">{{ text('В журнале') }}</dt><dd class="text-xl font-semibold tabular-nums">{{ state?.retained ?? '—' }}</dd></div>
              <div><dt class="text-muted-foreground">{{ text('Ожидают отправки') }}</dt><dd class="text-xl font-semibold tabular-nums">{{ state?.pending ?? '—' }}</dd></div>
              <div><dt class="text-muted-foreground">{{ text('Отправлены') }}</dt><dd class="text-xl font-semibold tabular-nums">{{ state?.delivered ?? '—' }}</dd></div>
              <div><dt class="text-muted-foreground">{{ text('Удалены ротацией / не приняты по лимиту') }}</dt><dd class="text-xl font-semibold tabular-nums">{{ state?.discarded ?? '—' }}</dd></div>
            </dl>
          </CardContent>
        </Card>
        <Card v-if="draft">
          <CardHeader class="p-4"><CardTitle class="text-base">{{ text('Хранение и ротация') }}</CardTitle><CardDescription>{{ text('Старые записи удаляются одним пакетом по расписанию.') }}</CardDescription></CardHeader>
          <CardContent class="p-4 pt-0">
            <form class="grid min-w-0 gap-4" @submit.prevent="save">
              <div class="grid min-w-0 gap-4 sm:grid-cols-3">
                <div class="grid content-start gap-2"><Label :for="`${fieldId}-limit`">{{ text('Записей после ротации') }}</Label><Input :id="`${fieldId}-limit`" :model-value="draft.maxEvents" type="number" min="100" max="5000" step="100" :disabled="busy" required @update:model-value="updateRetention('maxEvents', $event)" /></div>
                <div class="grid content-start gap-2"><Label :for="`${fieldId}-age`">{{ text('Срок хранения, дней') }}</Label><Input :id="`${fieldId}-age`" :model-value="draft.maxAgeDays" type="number" min="1" max="90" step="1" :disabled="busy" required @update:model-value="updateRetention('maxAgeDays', $event)" /></div>
                <div class="grid content-start gap-2"><Label :for="`${fieldId}-rotation`">{{ text('Ротация раз в, минут') }}</Label><Input :id="`${fieldId}-rotation`" :model-value="draft.rotationMinutes" type="number" min="1" max="60" step="1" :disabled="busy" required @update:model-value="updateRetention('rotationMinutes', $event)" /></div>
              </div>
              <p class="text-xs text-muted-foreground">{{ text('Между ротациями журнал может временно превышать выбранный лимит; при 10 000 записей новые события не принимаются до ротации. Последняя ротация: ') }}{{ date(state?.lastRotationAt) }}.</p>
              <Button type="submit" variant="outline" size="sm" class="justify-self-start" :disabled="busy || !dirty">{{ text('Сохранить параметры') }}</Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="external" class="space-y-4">
        <Card>
          <CardHeader class="p-4"><CardTitle class="text-base">{{ text('Внешняя отправка') }}</CardTitle><CardDescription>{{ text('Отдельное согласие на отправку технических событий. Временная недоступность оставляет очередь на устройстве для повторной отправки в пределах срока хранения. Постоянный отказ требует исправления подключения.') }}</CardDescription></CardHeader>
          <CardContent class="grid min-w-0 gap-4 p-4 pt-0">
            <form v-if="draft" class="grid min-w-0 gap-3" @submit.prevent="save">
              <div class="grid min-w-0 gap-2">
                <Label :for="`${fieldId}-endpoint`">HTTPS endpoint OTLP</Label>
                <Input :id="`${fieldId}-endpoint`" :model-value="draft?.endpoint ?? ''" type="url" placeholder="https://collector.example/v1/logs" autocomplete="off" :spellcheck="false" :disabled="busy" :aria-describedby="`${fieldId}-endpoint-help`" @update:model-value="updateEndpoint" />
                <p :id="`${fieldId}-endpoint-help`" class="text-xs text-muted-foreground">{{ text('Адрес без логина, пароля, query и fragment. Сохранение адреса не включает отправку; его изменение отзывает прежнее согласие.') }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" :disabled="!canProbeEndpoint" @click="probeEndpoint">{{ checkingEndpoint ? text('Проверка…') : text('Проверить endpoint') }}</Button>
                <Button type="submit" size="sm" :disabled="!canSaveEndpoint">{{ text('Сохранить endpoint') }}</Button>
                <Button v-if="configuration?.endpoint" type="button" variant="ghost" size="sm" :disabled="busy" @click="removeEndpoint">{{ text('Удалить endpoint') }}</Button>
              </div>
            </form>
            <div class="flex items-start justify-between gap-4 border-t pt-4">
              <div class="min-w-0 space-y-1.5">
                <Label :for="`${fieldId}-remote`">{{ text('Разрешить отправку технических событий') }}</Label>
                <p class="break-words text-xs text-muted-foreground">{{ text('На ') }}{{ configuration?.endpoint || text('сохранённый endpoint') }}{{ text('. Браузер может запросить разрешение для этого адреса.') }}</p>
              </div>
              <Switch :id="`${fieldId}-remote`" :model-value="state?.remoteEnabled ?? false" :disabled="busy || !state || (!state.remoteEnabled && (!state.localEnabled || !state.remoteAvailable || !configuration?.endpoint || dirty))" @update:model-value="toggleRemote" />
            </div>
            <p v-if="!state?.remoteAvailable" class="text-xs text-muted-foreground">{{ text('В этой установке нет доступного внешнего транспорта.') }}</p>
            <p v-else-if="!state?.localEnabled" class="text-xs text-muted-foreground">{{ text('Сначала включите локальный сбор.') }}</p>
            <div class="space-y-1 text-sm" role="status"><p>{{ text(deliveryLabel) }}</p><p class="text-xs text-muted-foreground">{{ text('Последняя успешная отправка: ') }}{{ date(state?.lastSentAt) }}{{ text('. Следующая попытка: ') }}{{ date(state?.nextAttemptAt) }}.</p></div>
            <Button type="button" variant="outline" size="sm" class="justify-self-start" :disabled="busy || !state?.remoteEnabled" @click="flushQueue">{{ text('Отправить очередь сейчас') }}</Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="journal" class="space-y-4">
        <div class="flex min-w-0 flex-wrap items-end gap-2">
          <div class="grid min-w-0 flex-1 basis-48 gap-2">
            <Label :for="`${fieldId}-provider`">{{ text('Источник событий') }}</Label>
            <Select :model-value="provider || 'all'" :disabled="busy" @update:model-value="selectProvider">
              <SelectTrigger :id="`${fieldId}-provider`" class="w-full min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{{ text('Все источники') }}</SelectItem><SelectItem v-for="id in state?.providers" :key="id" :value="id">{{ text(providerLabel(id)) }}</SelectItem></SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" :disabled="busy" @click="act(() => loadRecords())">{{ text('Обновить') }}</Button>
          <Button type="button" variant="outline" size="sm" :disabled="busy || !state?.retained" @click="exportJournal">{{ text('Сохранить JSON') }}</Button>
        </div>
        <p v-if="!records.length" class="py-4 text-sm text-muted-foreground">{{ state?.localEnabled ? text('Для выбранного источника пока нет событий.') : text('Журнал пуст. Включите локальный сбор, чтобы записывать новые события.') }}</p>
        <Table v-else class="table-fixed" :aria-label="text('Локальные технические события')">
          <TableHeader><TableRow><TableHead class="w-3/5">{{ text('Событие') }}</TableHead><TableHead>{{ text('Доставка') }}</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow v-for="record in records" :key="record.id">
              <TableCell class="align-top whitespace-normal">
                <div class="space-y-1 break-words"><p class="font-medium">{{ text(eventLabel(record.name)) }}</p><p class="text-xs text-muted-foreground">{{ text(providerLabel(record.providerId)) }}</p><time class="block text-xs text-muted-foreground" :datetime="new Date(record.timestamp).toISOString()">{{ date(record.timestamp) }}</time></div>
              </TableCell>
              <TableCell class="align-top whitespace-normal">
                <div class="space-y-1 break-words text-xs text-muted-foreground"><Badge variant="outline" class="max-w-full whitespace-normal">{{ record.state === 'sent' ? text('Отправлено') : record.state === 'sending' ? text('Отправляется') : text('Локально / в очереди') }}</Badge><p v-if="record.count !== undefined">{{ text('Количество: ') }}{{ record.count }}</p><p v-if="record.durationMs !== undefined">{{ record.durationMs }}{{ text(' мс') }}</p><p v-if="record.errorClass">{{ record.errorClass }}</p><p v-if="record.attempts">{{ text('Попыток: ') }}{{ record.attempts }}</p></div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Button v-if="more" type="button" variant="outline" size="sm" :disabled="busy" @click="act(() => loadRecords(true), '', false)">{{ text('Показать ещё') }}</Button>
        <p v-if="records.length > 50" class="text-xs text-muted-foreground">{{ text('Просмотр старых записей закреплён. «Обновить» покажет актуальные события с начала журнала.') }}</p>
        <Alert v-if="confirmClear" variant="destructive">
          <AlertTitle>{{ text('Удалить весь локальный журнал?') }}</AlertTitle>
          <AlertDescription class="grid gap-3"><p>{{ text('Будут удалены все источники и очередь отправки, даже если сейчас выбран один источник.') }}</p><div class="flex flex-wrap gap-2"><Button type="button" variant="destructive" size="sm" :disabled="busy" @click="clearJournal">{{ text('Удалить журнал') }}</Button><Button type="button" variant="outline" size="sm" :disabled="busy" @click="confirmClear = false">{{ text('Отмена') }}</Button></div></AlertDescription>
        </Alert>
        <Button v-else type="button" variant="ghost" size="sm" :disabled="busy || !state?.retained" @click="confirmClear = true">{{ text('Очистить журнал') }}</Button>
      </TabsContent>
    </Tabs>
    <p v-if="notice" role="status" class="text-sm text-muted-foreground">{{ text(notice) }}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ text(error) }}</p>
  </section>
</template>
