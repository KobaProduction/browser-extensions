<script setup lang="ts">
/** Reusable presentational backup controls. Never reads a product database. */
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
  Progress,
  Separator,
  Slider,
} from '@kobaproduction/browser-ui'
import { computed, ref, useId, watch } from 'vue'

const props = defineProps<{
  available: { settings: boolean; indexeddb: boolean }
  pending: boolean
  inspected?: { settings: boolean; indexeddb: boolean; rows: number; createdAt: string } | null
  error?: string
  success?: string
  progress?: { phase: string; completed: number; total: number; percent: number; entries: number } | null
}>()
const emit = defineEmits<{
  (
    event: 'export',
    options: { settings: boolean; indexeddb: boolean; compression: 'gzip' | 'none'; chunkRows: number },
  ): void
  (event: 'inspect', file: File): void
  (event: 'restore', options: { settings: boolean; indexeddb: boolean }): void
}>()
const settings = ref(true)
const indexeddb = ref(true)
const gzip = ref(true)
const chunkRows = ref(1024)
const restoreSettings = ref(true)
const restoreIndexed = ref(true)
const confirmed = ref(false)
const fieldId = useId()
const fileInputRevision = ref(0)
watch(
  [restoreSettings, restoreIndexed, () => props.inspected],
  () => {
    confirmed.value = false
  },
  { deep: true },
)
const progressPercent = computed(() =>
  props.progress && Number.isFinite(props.progress.percent)
    ? Math.min(100, Math.max(0, props.progress.percent))
    : null,
)
const canExport = computed(
  () =>
    !props.pending &&
    ((settings.value && props.available.settings) || (indexeddb.value && props.available.indexeddb)),
)
const canRestore = computed(
  () =>
    !!props.inspected &&
    !props.pending &&
    confirmed.value &&
    ((restoreSettings.value && props.inspected.settings) ||
      (restoreIndexed.value && props.inspected.indexeddb)),
)
function fileChanged(e: Event) {
  if (props.pending) return
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  confirmed.value = false
  fileInputRevision.value++
  if (file) emit('inspect', file)
}
function updateChunkRows(value: number[] | undefined) {
  const first = value?.[0]
  if (first !== undefined && Number.isFinite(first))
    chunkRows.value = Math.max(64, Math.min(2048, Math.round(first / 64) * 64))
}
function exportBackup() {
  if (canExport.value)
    emit('export', {
      settings: settings.value && props.available.settings,
      indexeddb: indexeddb.value && props.available.indexeddb,
      compression: gzip.value ? 'gzip' : 'none',
      chunkRows: chunkRows.value,
    })
}
function restoreBackup() {
  if (!canRestore.value) return
  const selected = {
    settings: restoreSettings.value && !!props.inspected?.settings,
    indexeddb: restoreIndexed.value && !!props.inspected?.indexeddb,
  }
  confirmed.value = false
  emit('restore', selected)
}
</script>
<template>
  <Card aria-label="Резервная копия приложения" :aria-busy="pending">
    <CardHeader class="p-4"><CardTitle class="text-base">Резервная копия</CardTitle><CardDescription>Постоянные настройки и IndexedDB выбираются независимо. Состояние текущей вкладки и сессии никогда не входит в этот формат резервной копии.</CardDescription></CardHeader>
    <CardContent class="grid min-w-0 gap-4 p-4 pt-0">
      <div class="flex items-start gap-3"><Checkbox :id="`${fieldId}-settings`" class="mt-0.5" :model-value="settings" :disabled="pending || !available.settings" @update:model-value="settings = $event === true" /><Label :for="`${fieldId}-settings`">Постоянные настройки приложения</Label></div>
      <div class="flex items-start gap-3"><Checkbox :id="`${fieldId}-indexeddb`" class="mt-0.5" :model-value="indexeddb" :disabled="pending || !available.indexeddb" @update:model-value="indexeddb = $event === true" /><Label :for="`${fieldId}-indexeddb`">Все записи доступных таблиц IndexedDB</Label></div>
      <div class="flex items-start gap-3"><Checkbox :id="`${fieldId}-gzip`" class="mt-0.5" :model-value="gzip" :disabled="pending" @update:model-value="gzip = $event === true" /><Label :for="`${fieldId}-gzip`">Сжать весь TAR (GZIP)</Label></div>
      <div class="grid gap-3"><Label :id="`${fieldId}-chunk-label`">Размер чанка: {{ chunkRows }} записей IndexedDB</Label><Slider :model-value="[chunkRows]" :min="64" :max="2048" :step="64" :disabled="pending" :aria-labelledby="`${fieldId}-chunk-label`" @update:model-value="updateChunkRows" /></div>
      <Button type="button" size="sm" variant="outline" class="justify-self-start" :disabled="!canExport" @click="exportBackup">Сохранить TAR / TAR.GZ</Button>
      <Separator />
      <div class="grid min-w-0 gap-2"><Label :for="`${fieldId}-file`">Проверить файл резервной копии</Label><Input :id="`${fieldId}-file`" :key="fileInputRevision" type="file" accept=".tar,.tar.gz,.tgz,application/x-tar,application/gzip" :disabled="pending" @change="fileChanged" /></div>
      <template v-if="inspected">
        <p role="status" class="text-xs text-muted-foreground">Файл проверен: {{ inspected.rows }} записей IndexedDB, {{ inspected.createdAt }}.</p>
        <div v-if="inspected.settings" class="flex items-start gap-3"><Checkbox :id="`${fieldId}-restore-settings`" class="mt-0.5" :model-value="restoreSettings" :disabled="pending" @update:model-value="restoreSettings = $event === true" /><Label :for="`${fieldId}-restore-settings`">Восстановить постоянные настройки</Label></div>
        <div v-if="inspected.indexeddb" class="flex items-start gap-3"><Checkbox :id="`${fieldId}-restore-indexeddb`" class="mt-0.5" :model-value="restoreIndexed" :disabled="pending" @update:model-value="restoreIndexed = $event === true" /><Label :for="`${fieldId}-restore-indexeddb`">Восстановить IndexedDB (заменить записи этого владельца)</Label></div>
        <Separator />
        <div class="flex items-start gap-3"><Checkbox :id="`${fieldId}-confirm`" class="mt-0.5" :model-value="confirmed" :disabled="pending" @update:model-value="confirmed = $event === true" /><Label :for="`${fieldId}-confirm`">Подтверждаю восстановление выбранных разделов</Label></div>
        <Button type="button" size="sm" variant="outline" class="justify-self-start" :disabled="!canRestore" @click="restoreBackup">Восстановить выбранное</Button>
      </template>
      <div v-if="progress" class="grid gap-2 text-xs" role="status" aria-live="polite"><span>Этап: {{ progress.phase }} · {{ progress.completed }} из {{ progress.total }} записей</span><span>{{ progress.percent }}% · файлов в архиве: {{ progress.entries }}</span><Progress :model-value="progressPercent" :aria-label="`Этап: ${progress.phase}`" /></div>
      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
      <p v-if="success" role="status" class="text-sm">{{ success }}</p>
      <p class="text-xs text-muted-foreground">Один переносимый TAR с независимыми настройками, схемой и записями таблиц; сжатие применяется ко всему файлу. Внешние медиафайлы не включаются.</p>
    </CardContent>
  </Card>
</template>
