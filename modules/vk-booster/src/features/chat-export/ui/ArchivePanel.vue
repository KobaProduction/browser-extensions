<script setup lang="ts">
/** VK-only archive API adapter. Generic ArchiveManager owns presentation, never VK storage. */

import {
  ArchiveManager,
  type ArchiveManagerOptions,
  type ArchiveManagerState,
} from '@kobaproduction/browser-widgets'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { exportVkCaptureSettings, restoreVkCaptureSettings } from '../model/settings-backup'
import { type ArchiveStatus, archiveApi } from '../model/types'
import ArchivePreview from './ArchivePreview.vue'

const api = archiveApi()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
const error = ref('')
const previewOpen = ref(false)
const fixedBusy = ref(false)
const fixedLimit = ref(100)
const fixedSaved = ref<number | null>(null)
const fixedError = ref('')
const fixedPreview = ref<readonly { id: number; text: string }[]>([])
async function captureDexie() {
  if (!api || fixedBusy.value) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    const result = await api.captureFixed(fixedLimit.value)
    fixedSaved.value = result.saved
    fixedPreview.value = []
  } catch {
    fixedError.value = 'Не удалось сохранить историю в Dexie: проверь VK API, владельца и диалог.'
  } finally {
    fixedBusy.value = false
  }
}
async function readDexie() {
  if (!api || fixedBusy.value) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    const records = await api.readFixed(100)
    fixedPreview.value = records.map((row) => ({
      id: row.id,
      text: typeof row.text === 'string' ? row.text : '',
    }))
  } catch {
    fixedError.value = 'Dexie-архив недоступен для текущего проверенного диалога.'
  } finally {
    fixedBusy.value = false
  }
}
async function exportDexie() {
  if (!api || fixedBusy.value) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    const blob = await api.exportFixed()
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = 'vk-fixed-v1-original.jsonl.gz'
      a.click()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  } catch {
    fixedError.value = 'Экспорт Dexie не выполнен. Сохранённая история не изменена.'
  } finally {
    fixedBusy.value = false
  }
}
const preferencesBusy = ref(false)
const preferencesFile = ref<File | null>(null)
const preferencesConfirmed = ref(false)
const preferencesError = ref('')
const preferencesMessage = ref('')
const preferencesRevision = ref(0)

function selectPreferences(event: Event) {
  preferencesFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
  preferencesConfirmed.value = false
  preferencesError.value = ''
  preferencesMessage.value = ''
}
async function downloadPreferences() {
  if (!api || preferencesBusy.value || status.value?.busy) return
  preferencesBusy.value = true
  preferencesError.value = ''
  preferencesMessage.value = ''
  try {
    const blob = await exportVkCaptureSettings(api)
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'vk-booster-capture-preset.json'
      link.click()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    preferencesMessage.value = 'Профиль подготовлен. Убедись, что файл сохранился.'
  } catch {
    preferencesError.value = 'Не удалось выгрузить профиль настроек.'
  } finally {
    preferencesBusy.value = false
  }
}
async function importPreferences() {
  if (!api || !preferencesFile.value || !preferencesConfirmed.value || preferencesBusy.value) return
  preferencesBusy.value = true
  preferencesError.value = ''
  preferencesMessage.value = ''
  try {
    await restoreVkCaptureSettings(api, preferencesFile.value)
    status.value = api.status()
    preferencesRevision.value++
    preferencesMessage.value = 'Параметры применены к текущей сессии. Папка и сообщения не изменены.'
    preferencesFile.value = null
    preferencesConfirmed.value = false
  } catch {
    preferencesError.value = 'Профиль отклонён: проверь целостность, формат и DEV/PROD канал.'
  } finally {
    preferencesBusy.value = false
  }
}
let unsubscribe: (() => void) | undefined
let peerTimer: ReturnType<typeof setInterval> | undefined
function refreshActiveConversation() {
  const next = api?.status()
  if (!next) return
  const previous = status.value
  if (previous?.activePeerId !== next.activePeerId) {
    fixedPreview.value = []
    fixedSaved.value = null
    fixedError.value = ''
  }
  if (
    !previous ||
    next.activePeerId !== previous.activePeerId ||
    next.blockedReason !== previous.blockedReason ||
    next.options.peerId !== previous.options.peerId
  )
    status.value = next
}
const view = computed<ArchiveManagerState | null>(() => {
  const current = status.value
  if (!current) return null
  const p = current.progress
  return {
    context: 'Диалог ' + (current.options.peerId || 'не выбран'),
    folder: current.folder,
    messages: current.messages,
    busy: current.busy,
    folderPending: current.folderPending,
    paused: current.checkpoint?.status === 'paused',
    blockedReason: current.blockedReason,
    phase: p.phase,
    done: p.done,
    total: p.total,
    newCount: p.newCount ?? 0,
    downloaded: p.downloaded ?? 0,
    failed: p.failed ?? 0,
    error: p.error,
  }
})
onMounted(() => {
  unsubscribe = api?.subscribe((next) => {
    status.value = next
  })
  // VK uses soft navigation; do not patch its History API or poll while closed.
  peerTimer = setInterval(refreshActiveConversation, 1500)
})
onUnmounted(() => {
  unsubscribe?.()
  if (peerTimer !== undefined) clearInterval(peerTimer)
})
async function chooseFolder() {
  error.value = ''
  try {
    await api?.selectFolder()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
async function start(options: ArchiveManagerOptions) {
  error.value = ''
  try {
    await api?.run(options)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
async function resume() {
  error.value = ''
  try {
    await api?.resume()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>
<template>
  <section v-if="api && status" class="booster-stack-card" aria-label="Фиксированный Dexie архив VK">
    <div class="booster-setting-copy">
      <b>Dexie — собственная база сообщений</b>
      <small>Захват только текущего проверенного VK-диалога. Папка Archive v2 не требуется и не изменяется.</small>
      <small v-if="fixedSaved !== null">Новых записей: {{ fixedSaved }}</small>
    </div>
    <label class="booster-field">Максимум сообщений
      <input v-model.number="fixedLimit" type="number" min="1" max="3000" step="1"
        class="booster-input" :disabled="fixedBusy || status.busy" />
    </label>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="booster-disclosure"
        :disabled="fixedBusy || status.busy || !status.activePeerId" @click="captureDexie">
        Сохранить текущий диалог в Dexie
      </button>
      <button type="button" class="booster-disclosure"
        :disabled="fixedBusy || status.busy || !status.activePeerId" @click="readDexie">
        Читать Dexie
      </button>
      <button type="button" class="booster-disclosure"
        :disabled="fixedBusy || status.busy || !status.activePeerId" @click="exportDexie">
        Экспорт Dexie JSON.gz
      </button>
    </div>
    <p v-if="fixedError" role="alert">{{ fixedError }}</p>
    <ol v-if="fixedPreview.length" class="max-h-60 overflow-y-auto p-2">
      <li v-for="message in fixedPreview" :key="message.id" class="border-b border-border py-2">
        <b>{{ message.id }}</b>
        <p class="whitespace-pre-wrap break-words">{{ message.text }}</p>
      </li>
    </ol>
  </section>
  <ArchiveManager v-if="status && view" :key="preferencesRevision" :state="view" :initial="status.options" :error="error"
    title="Архив переписки VK" @choose-folder="chooseFolder" @start="start"
    @stop="api?.stop()" @resume="resume"/>
  <template v-if="api && status?.folder && !status.blockedReason && status.messages > 0">
    <div class="flex justify-end">
      <button
        type="button"
        class="booster-disclosure"
        :aria-expanded="previewOpen"
        @click="previewOpen = !previewOpen"
      >{{ previewOpen ? 'Скрыть сохранённые сообщения' : 'Просмотр сохранённых сообщений' }}</button>
    </div>
    <div v-if="previewOpen" id="vk-archive-preview">
      <ArchivePreview :api="api" :status="status" />
    </div>
  </template>
  <section v-if="api && status" class="booster-stack-card" aria-label="Профиль параметров VK">
    <div class="booster-setting-copy">
      <b>Профиль параметров выгрузки</b>
      <small>Только режим, диапазон, размер пачки и загрузка файлов. Без сообщений, токенов, ID диалога и архива. Импорт действует в текущей сессии.</small>
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="booster-disclosure" type="button" :disabled="preferencesBusy || status.busy || !!status.blockedReason"
        @click="downloadPreferences">Сохранить профиль в JSON</button>
      <label class="booster-field">
        <span>Загрузить профиль JSON</span>
        <input type="file" class="booster-input" accept=".json,application/json"
          :disabled="preferencesBusy || status.busy" @change="selectPreferences" />
      </label>
    </div>
    <label v-if="preferencesFile" class="booster-field">
      <span><input v-model="preferencesConfirmed" type="checkbox" :disabled="preferencesBusy"/> Подтверждаю замену параметров текущей сессии</span>
    </label>
    <button v-if="preferencesFile" class="booster-disclosure" type="button"
      :disabled="preferencesBusy || status.busy || !!status.blockedReason || !preferencesConfirmed"
      @click="importPreferences">Применить профиль</button>
    <p v-if="preferencesError" role="alert" class="text-sm text-destructive">{{ preferencesError }}</p>
    <p v-if="preferencesMessage" role="status" class="text-sm">{{ preferencesMessage }}</p>
  </section>
  <section v-if="!status || !view" class="booster-setting-card"><span>Модуль VK Booster ещё не инициализирован.</span></section>
</template>
