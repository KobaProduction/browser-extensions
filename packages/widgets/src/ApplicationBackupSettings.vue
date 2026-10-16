<script setup lang="ts">
import {
  APPLICATION_BACKUP,
  type ApplicationBackupController,
  type BackupInspection,
  type BackupRecoveryInfo,
  type BackupSectionInfo,
} from '@kobaproduction/browser-core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Separator,
  useApplicationLocale,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { inject, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { WIDGET_UI_MESSAGES } from './ui-messages'

const locale = useApplicationLocale()
const text = useLocalizedText(WIDGET_UI_MESSAGES)

const fieldId = useId()
const controller = inject<ApplicationBackupController | null>(APPLICATION_BACKUP, null)
const sources = ref<readonly BackupSectionInfo[]>([])
const selected = ref<string[]>([])
const inspected = ref<BackupInspection | null>(null)
const restoring = ref<string[]>([])
const file = ref<File | null>(null)
const fileInputRevision = ref(0)
const busy = ref(false),
  error = ref(''),
  status = ref(''),
  confirmed = ref(false)
const recoveries = ref<readonly BackupRecoveryInfo[]>([])
const rollbackConfirmed = ref(''),
  discardConfirmed = ref('')
watch(
  restoring,
  () => {
    confirmed.value = false
  },
  { deep: true },
)
let unsubscribe: (() => void) | undefined
let disposed = false
function selectSection(target: 'save' | 'restore', id: string, checked: unknown) {
  const current = target === 'save' ? selected : restoring
  current.value =
    checked === true
      ? [...new Set([...current.value, id])]
      : current.value.filter((value) => value !== id)
}
async function refresh() {
  if (!controller) return
  const [available, pending] = await Promise.all([controller.status(), controller.recoveries?.() ?? []])
  if (disposed) return
  sources.value = available
  recoveries.value = pending
}
async function refreshRecoveries() {
  if (!controller?.recoveries || disposed) return
  try {
    const pending = await controller.recoveries()
    if (!disposed) recoveries.value = pending
  } catch {
    /* Preserve the last known list when the current owner is unavailable. */
  }
}
async function perform(action: () => Promise<void>) {
  if (busy.value || disposed) return
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    await action()
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') status.value = 'Операция отменена.'
    else
      error.value =
        'Операция не выполнена. Проверьте доступность выбранных разделов, владельца и целостность файла.'
  } finally {
    await refreshRecoveries()
    busy.value = false
  }
}
async function save() {
  await perform(async () => {
    if (!controller) return
    const data = controller.save
      ? await controller.save(selected.value)
      : await controller.export(selected.value)
    if (data) {
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = `browser-tools-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    }
    status.value = data
      ? 'Резервная копия подготовлена для скачивания.'
      : 'Резервная копия сохранена в выбранный файл.'
  })
}
async function inspect(event: Event) {
  if (busy.value || disposed) return
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  fileInputRevision.value++
  inspected.value = null
  restoring.value = []
  confirmed.value = false
  await perform(async () => {
    if (!controller || !file.value) return
    inspected.value = await controller.inspect(file.value)
    restoring.value = inspected.value.sections
      .filter((section) => section.available)
      .map((section) => section.id)
  })
}
async function restore() {
  await perform(async () => {
    if (!controller || !file.value || !confirmed.value) return
    await controller.restore(file.value, restoring.value)
    confirmed.value = false
    status.value = 'Выбранные разделы восстановлены.'
    await refresh()
  })
}
async function retryRollback(job: BackupRecoveryInfo) {
  if (rollbackConfirmed.value !== job.id || !job.canRollback) return
  await perform(async () => {
    if (!controller?.retryRollback) return
    await controller.retryRollback(job.id)
    rollbackConfirmed.value = ''
    status.value = 'Данные возвращены к состоянию перед прерванным восстановлением.'
    await refresh()
  })
}
async function discardRecovery(job: BackupRecoveryInfo) {
  if (discardConfirmed.value !== job.id) return
  await perform(async () => {
    if (!controller?.discardRecovery) return
    await controller.discardRecovery(job.id)
    discardConfirmed.value = ''
    rollbackConfirmed.value = ''
    status.value = 'Временная копия удалена.'
  })
}
function cancel() {
  controller?.cancel?.()
  status.value = 'Отмена запрошена. Если запись уже началась, дождитесь завершения отката.'
}
onMounted(async () => {
  await perform(refresh)
  if (disposed) return
  selected.value = sources.value
    .filter((source) => source.available && source.kind !== 'session')
    .map((source) => source.id)
  unsubscribe = controller?.subscribe(() => {
    if (!busy.value) void perform(refresh)
  })
})
onUnmounted(() => {
  disposed = true
  unsubscribe?.()
})
</script>
<template>
  <section class="space-y-4" :aria-label="text('Резервные копии')">
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ text('Резервные копии') }}</h2>
      <p class="text-sm text-muted-foreground">{{ text('Настройки, состояние интерфейса и база данных сохраняются отдельными разделами одного файла.') }}</p>
    </div>
    <Alert v-if="!controller"><AlertDescription>{{ text('Резервное копирование недоступно в этом окружении.') }}</AlertDescription></Alert>
    <template v-else>
      <Card v-if="recoveries.length">
        <CardHeader><CardTitle class="text-base">{{ text('Незавершённые операции') }}</CardTitle><CardDescription>{{ text('Временные копии сохранены. Выберите действие для каждой операции.') }}</CardDescription></CardHeader>
        <CardContent class="space-y-5">
          <div v-for="(job,index) in recoveries" :key="job.id" class="space-y-3">
            <Separator v-if="index" />
            <p class="text-sm font-medium">{{ new Date(job.createdAt).toLocaleString(locale) }}</p>
            <p v-if="job.reason" class="text-sm text-muted-foreground">{{ text(job.reason) }}</p>
            <p class="text-sm">{{ job.sections.map(section=>text(section.label)).join(' · ') }}</p>
            <template v-if="job.canRollback && controller.retryRollback">
              <div class="flex items-start gap-3"><Checkbox :id="`${fieldId}-rollback-${index}`" class="mt-0.5" :model-value="rollbackConfirmed === job.id" :disabled="busy || job.sections.some(section=>!section.available)" @update:model-value="rollbackConfirmed = $event === true ? job.id : ''" /><Label :for="`${fieldId}-rollback-${index}`">{{ text('Вернуть данные к состоянию перед этой операцией') }}</Label></div>
              <p v-if="job.sections.some(section=>!section.available)" class="text-xs text-muted-foreground">{{ text('Для отката нужны тот же аккаунт и все исходные разделы.') }}</p>
              <Button :disabled="busy || rollbackConfirmed !== job.id || job.sections.some(section=>!section.available)" @click="retryRollback(job)">{{ text('Повторить откат') }}</Button>
            </template>
            <template v-if="controller.discardRecovery">
              <Alert v-if="discardConfirmed === job.id" variant="destructive"><AlertDescription class="space-y-3"><p>{{ text('Удалится только временная копия. Если восстановление было прервано, возможность отката из неё будет потеряна.') }}</p><div class="flex flex-wrap gap-2"><Button variant="destructive" :disabled="busy" @click="discardRecovery(job)">{{ text('Удалить временную копию') }}</Button><Button variant="outline" :disabled="busy" @click="discardConfirmed = ''">{{ text('Оставить') }}</Button></div></AlertDescription></Alert>
              <Button v-else variant="outline" :disabled="busy" @click="discardConfirmed = job.id">{{ text('Удалить временную копию…') }}</Button>
            </template>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">{{ text('Создать копию') }}</CardTitle><CardDescription>{{ text('Выберите нужные разделы.') }}</CardDescription></CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-3">
            <div v-for="source in sources" :key="source.id" class="flex items-start gap-3">
              <Checkbox :id="`${fieldId}-save-${source.id}`" class="mt-0.5" :model-value="selected.includes(source.id)" :disabled="busy || !source.available" @update:model-value="selectSection('save',source.id,$event)" />
              <div class="grid gap-1"><Label :for="`${fieldId}-save-${source.id}`">{{ text(source.label) }}</Label><p v-if="source.reason" class="text-xs text-muted-foreground">{{ text(source.reason) }}</p></div>
            </div>
          </div>
          <Button :disabled="busy || !selected.length" @click="save">{{ text('Сохранить выбранное') }}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">{{ text('Восстановить из файла') }}</CardTitle><CardDescription>{{ text('Сначала проверим файл и покажем его состав.') }}</CardDescription></CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-2"><Label :for="`${fieldId}-file`">{{ text('Файл резервной копии') }}</Label><Input :key="fileInputRevision" :id="`${fieldId}-file`" type="file" accept=".tar,.tar.gz,.tgz" :disabled="busy" @change="inspect" /></div>
          <template v-if="inspected">
            <Separator />
            <p class="text-sm text-muted-foreground">{{ text('Создано ') }}{{ new Date(inspected.createdAt).toLocaleString(locale) }}</p>
            <div class="grid gap-3">
              <div v-for="section in inspected.sections" :key="section.id" class="flex items-start gap-3">
                <Checkbox :id="`${fieldId}-restore-${section.id}`" class="mt-0.5" :model-value="restoring.includes(section.id)" :disabled="busy || !section.available" @update:model-value="selectSection('restore',section.id,$event)" />
                <div class="grid gap-1"><Label :for="`${fieldId}-restore-${section.id}`">{{ text(section.label) }} <span class="text-muted-foreground">· {{ section.rows }}{{ text(' записей') }}</span></Label><p v-if="section.reason" class="text-xs text-muted-foreground">{{ text(section.reason) }}</p></div>
              </div>
            </div>
            <Separator />
            <div class="flex items-start gap-3"><Checkbox :id="`${fieldId}-confirm`" class="mt-0.5" :model-value="confirmed" :disabled="busy" @update:model-value="confirmed = $event === true" /><Label :for="`${fieldId}-confirm`">{{ text('Заменить выбранные разделы данными из файла') }}</Label></div>
            <Button :disabled="busy || !confirmed || !restoring.length" @click="restore">{{ text('Восстановить выбранное') }}</Button>
          </template>
        </CardContent>
      </Card>
      <div v-if="busy" class="flex flex-wrap items-center gap-3"><p role="status" class="text-sm text-muted-foreground">{{ text('Обрабатываем выбранные разделы…') }}</p><Button v-if="controller.cancel" variant="outline" @click="cancel">{{ text('Отменить') }}</Button></div>
      <Alert v-if="error" variant="destructive"><AlertDescription>{{ text(error) }}</AlertDescription></Alert>
      <Alert v-if="status"><AlertDescription role="status">{{ text(status) }}</AlertDescription></Alert>
      <p class="text-xs text-muted-foreground">{{ text('Пароли и токены не включаются. Доступна база проверенного аккаунта текущего сайта. Внешние вложения сохраняются отдельно. Большие копии сохраняются прямо в выбранный файл, если браузер поддерживает этот способ; скачивание через память ограничено 128 МиБ сжатых данных. Для проверки и восстановления нужно свободное место под временные данные и копию для отката.') }}</p>
    </template>
  </section>
</template>
