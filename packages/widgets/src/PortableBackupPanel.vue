<script setup lang="ts">
/** Reusable presentational backup controls. Never reads a product database. */
import { Button } from '@kobaproduction/browser-ui'
import { computed, ref } from 'vue'

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
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  confirmed.value = false
  if (file) emit('inspect', file)
  input.value = ''
}
</script>
<template>
  <section class="booster-stack-card" aria-label="Резервная копия приложения">
    <div class="booster-setting-copy">
      <b>Резервная копия</b>
      <small>Постоянные настройки и IndexedDB — независимо. Состояние текущей вкладки и сессии никогда не входит в резервную копию.</small>
    </div>
    <label class="booster-field">
      <span class="flex items-center gap-2"><input v-model="settings" type="checkbox" :disabled="pending || !available.settings" />Persistent-настройки (Pinia / браузерное хранилище)</span>
    </label>
    <label class="booster-field">
      <span class="flex items-center gap-2"><input v-model="indexeddb" type="checkbox" :disabled="pending || !available.indexeddb" />Все записи доступных таблиц IndexedDB</span>
    </label>
    <label class="booster-field">
      <span class="flex items-center gap-2"><input v-model="gzip" type="checkbox" :disabled="pending" />Сжать весь TAR (GZIP)</span>
    </label>
    <label class="booster-field">
      <span>Размер чанка: {{ chunkRows }} записей IndexedDB</span>
      <input v-model.number="chunkRows" type="range" min="64" max="2048" step="64" :disabled="pending" />
    </label>
    <Button size="sm" variant="outline" :disabled="!canExport" @click="emit('export', { settings: settings && available.settings, indexeddb: indexeddb && available.indexeddb, compression: gzip ? 'gzip' : 'none', chunkRows })">Сохранить TAR / TAR.GZ</Button>
    <label class="booster-field">
      <span>Проверить файл резервной копии</span>
      <input type="file" class="booster-input w-full" accept=".tar,.tar.gz,.tgz,application/x-tar,application/gzip" :disabled="pending" @change="fileChanged" />
    </label>
    <template v-if="inspected">
      <p role="status" class="m-0 text-xs">Файл проверен: {{ inspected.rows }} записей IndexedDB, {{ inspected.createdAt }}.</p>
      <label v-if="inspected.settings" class="booster-field"><span class="flex items-center gap-2"><input v-model="restoreSettings" type="checkbox" :disabled="pending" />Восстановить persistent-настройки</span></label>
      <label v-if="inspected.indexeddb" class="booster-field"><span class="flex items-center gap-2"><input v-model="restoreIndexed" type="checkbox" :disabled="pending" />Восстановить IndexedDB (заменить записи этого владельца)</span></label>
      <label class="booster-field"><span class="flex items-center gap-2"><input v-model="confirmed" type="checkbox" :disabled="pending" />Подтверждаю восстановление выбранных разделов</span></label>
      <Button size="sm" variant="outline" :disabled="!canRestore" @click="emit('restore', { settings: restoreSettings && !!inspected?.settings, indexeddb: restoreIndexed && !!inspected?.indexeddb })">Восстановить выбранное</Button>
    </template>
    <div v-if="progress" class="booster-setting-copy" role="status" aria-live="polite">
      <span>Этап: {{ progress.phase }} · {{ progress.completed }} из {{ progress.total }} записей</span>
      <span>{{ progress.percent }}% · файлов в архиве: {{ progress.entries }}</span>
      <progress class="w-full" :value="progress.completed" :max="Math.max(1, progress.total)" />
    </div>
    <p v-if="error" role="alert" class="m-0 text-sm text-destructive">{{ error }}</p>
    <p v-if="success" role="status" class="m-0 text-sm">{{ success }}</p>
    <p class="m-0 text-xs text-muted-foreground">Один переносимый TAR.GZ: manifest.json, persistent/settings.json, indexeddb/schema.json и обычные JSONL-чанки таблиц, сжатые общим потоком GZIP. Внешние медиафайлы не включаются.</p>
  </section>
</template>
