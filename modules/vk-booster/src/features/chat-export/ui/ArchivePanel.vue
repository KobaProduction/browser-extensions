<script setup lang="ts">
/** VK-only archive API adapter. Generic ArchiveManager owns presentation, never VK storage. */

import { Badge, Button } from '@kobaproduction/browser-ui'
import { ArchiveProgressBar } from '@kobaproduction/browser-widgets'
import { Archive, Download, Settings2, ShieldAlert } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import { vkPreferencesLoadError, vkPreferencesPersistence } from '../model/durable-preferences'
import {
  exportVkCaptureSettings,
  restoreVkCaptureSettings,
  validateVkCapturePreferences,
} from '../model/settings-backup'
import { type ArchiveStatus, archiveApi, type VkMessage } from '../model/types'

const api = archiveApi()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
const error = ref('')
type View = 'capture' | 'reader' | 'settings'
const tab = ref<View>('capture')
const tabPrefix = useId()
const selectedStatus = computed(() => {
  if (status.value?.busy || fixedBusy.value) return 'Захват сообщений'
  if (status.value?.blockedReason) return 'Другой диалог'
  return status.value?.activePeerId ? 'Dexie v1' : 'Открой переписку'
})
const fixedBusy = ref(false)
const fixedLimit = ref(Math.min(3000, Math.max(1, status.value?.options.limit ?? 100)))
const fixedSaved = ref<number | null>(null)
const fixedError = ref('')
const fixedPreview = ref<readonly VkMessage[]>([])
const fixedCursor = ref<number | undefined>()
const fixedNextCursor = ref<number | undefined>()
const fixedReading = ref(false)
const hasVerifiedPeer = computed(() => !!status.value?.activePeerId && !status.value?.blockedReason)
const captureProgress = computed(() => status.value?.progress)
async function persistCaptureLimit() {
  if (!api) throw Error('VK unavailable')
  const options = validateVkCapturePreferences({ ...api.status().options, limit: fixedLimit.value })
  api.configure(options)
  const port = vkPreferencesPersistence()
  try {
    if (!port) throw Error('VK settings storage unavailable')
    await port.write(options)
    durableSettingsError.value = ''
  } catch {
    durableSettingsError.value = 'Не удалось сохранить параметры для следующего запуска.'
  }
}
async function captureDexie() {
  if (!api || fixedBusy.value || !hasVerifiedPeer.value) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    await persistCaptureLimit()
    const result = await api.captureFixed(fixedLimit.value)
    fixedSaved.value = result.saved
    fixedPreview.value = []
    fixedCursor.value = undefined
    fixedNextCursor.value = undefined
  } catch {
    fixedError.value = 'Не удалось сохранить историю в Dexie: проверь VK API и текущий диалог.'
  } finally {
    fixedBusy.value = false
  }
}
async function readDexie(cursor?: number) {
  if (!api || fixedBusy.value || fixedReading.value || !hasVerifiedPeer.value) return
  fixedReading.value = true
  fixedError.value = ''
  try {
    const rows = await api.readFixed(80, cursor)
    fixedPreview.value = rows
    fixedCursor.value = cursor
    fixedNextCursor.value = rows.length === 80 ? rows.at(-1)?.id : undefined
  } catch {
    fixedPreview.value = []
    fixedCursor.value = undefined
    fixedNextCursor.value = undefined
    fixedError.value = 'Dexie-архив недоступен для текущего проверенного диалога.'
  } finally {
    fixedReading.value = false
  }
}
async function exportDexie() {
  if (!api || fixedBusy.value || !hasVerifiedPeer.value) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    const blob = await api.exportFixed()
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'vk-fixed-v1-original.jsonl.gz'
      link.click()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  } catch {
    fixedError.value = 'Экспорт Dexie не выполнен. Сохранённая история не изменена.'
  } finally {
    fixedBusy.value = false
  }
}
const tabs: { id: View; label: string; icon: typeof Archive }[] = [
  { id: 'capture', label: 'Выгрузка', icon: Download },
  { id: 'reader', label: 'Архив', icon: Archive },
  { id: 'settings', label: 'Параметры', icon: Settings2 },
]
function onTabKeydown(event: KeyboardEvent, active: View) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = tabs.findIndex((item) => item.id === active)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
  const selected = tabs[next]
  if (!selected) return
  tab.value = selected.id
  const target = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(
    '#' + tabPrefix + '-tab-' + selected.id,
  )
  target?.focus()
}
const preferencesBusy = ref(false)
const preferencesFile = ref<File | null>(null)
const preferencesConfirmed = ref(false)
const preferencesError = ref('')
const preferencesMessage = ref('')
const durableSettingsError = ref(vkPreferencesLoadError())

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
    const port = vkPreferencesPersistence()
    if (!port) throw Error('Persistent settings unavailable')
    await restoreVkCaptureSettings(api, preferencesFile.value, port)
    status.value = api.status()
    fixedLimit.value = Math.min(3000, Math.max(1, api.status().options.limit))
    preferencesMessage.value =
      'Параметры восстановлены в текущей сессии и постоянном хранилище. Архив не изменён.'
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
    fixedCursor.value = undefined
    fixedNextCursor.value = undefined
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
onMounted(() => {
  unsubscribe = api?.subscribe((next) => {
    status.value = next
  })
  // Detect host SPA peer change while the Control Center is open.
  peerTimer = setInterval(refreshActiveConversation, 1500)
})
onUnmounted(() => {
  unsubscribe?.()
  if (peerTimer !== undefined) clearInterval(peerTimer)
})
</script>
<template>
  <section class="flex min-w-0 flex-col gap-3" aria-label="VK Booster — управление архивом">
    <header class="booster-setting-card">
      <div class="booster-setting-copy min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <Archive class="size-4 shrink-0" aria-hidden="true" />
          <b>VK Booster · Архив v1</b>
          <Badge :variant="status?.blockedReason ? 'secondary' : status?.busy ? 'default' : 'outline'" :class="status?.blockedReason ? 'text-destructive' : ''">
            {{ selectedStatus }}
          </Badge>
        </div>
        <span v-if="hasVerifiedPeer">Текущий диалог: {{ status?.activePeerId }} · Данные в Dexie, без файловой папки</span>
        <span v-else>Открой VK-переписку, чтобы работать с архивом.</span>
      </div>
    </header>
    <p v-if="status?.blockedReason" class="m-0 flex items-start gap-2 text-sm text-destructive" role="alert">
      <ShieldAlert class="size-4 shrink-0" aria-hidden="true" />
      {{ status.blockedReason }}. Вернись в выбранный диалог перед работой с архивом.
    </p>
    <nav aria-label="Разделы VK Booster" class="flex flex-wrap gap-2" role="tablist">
      <Button
        v-for="item in tabs"
        :id="tabPrefix + '-tab-' + item.id"
        :key="item.id"
        type="button"
        role="tab"
        size="sm"
        :variant="tab === item.id ? 'default' : 'outline'"
        :aria-controls="tabPrefix + '-panel-' + item.id"
        :aria-selected="tab === item.id"
        :tabindex="tab === item.id ? 0 : -1"
        @click="tab = item.id"
        @keydown="onTabKeydown($event, item.id)"
      >
        <component :is="item.icon" class="size-4" aria-hidden="true" />
        {{ item.label }}
      </Button>
    </nav>
    <!-- Capture and reader share the fixed owner-scoped Dexie repository. -->
    <div
      :id="tabPrefix + '-panel-capture'"
      v-show="tab === 'capture'"
      role="tabpanel"
      :aria-labelledby="tabPrefix + '-tab-capture'"
      tabindex="0"
      class="flex min-w-0 flex-col gap-3"
    >
      <section class="booster-stack-card" aria-label="Захват в Dexie">
        <div class="booster-setting-copy">
          <b>Локальный архив Dexie v1</b>
          <span>Сохраняет оригинальные записи текущего проверенного диалога. Повторный захват пропускает совпадающие сообщения.</span>
        </div>
        <label class="booster-field">Количество последних сообщений (1–3000)
          <input v-model.number="fixedLimit" class="booster-input" type="number" min="1" max="3000" :disabled="fixedBusy" />
        </label>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="fixedBusy || !hasVerifiedPeer" @click="captureDexie">
            <Download class="size-4" aria-hidden="true" />Сохранить в Dexie
          </Button>
          <Button variant="outline" :disabled="!fixedBusy" @click="api?.stop()">Остановить</Button>
          <Button variant="outline" :disabled="fixedBusy || !hasVerifiedPeer" @click="exportDexie">Экспорт .jsonl.gz</Button>
        </div>
        <p v-if="fixedSaved !== null" role="status">Новых сообщений: {{ fixedSaved }}.</p>
        <ArchiveProgressBar
          v-if="captureProgress?.total"
          label="Прогресс сохранения VK в Dexie"
          :percent="Math.min(100, Math.round(100 * (captureProgress.done / captureProgress.total)))"
          :counter="`${captureProgress.done} / ${captureProgress.total}`"
          compact
        />
        <p v-if="captureProgress?.phase" role="status">{{ captureProgress.phase }}: {{ captureProgress.done }} / {{ captureProgress.total }}</p>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ fixedError }}</p>
        <p v-if="durableSettingsError" role="alert" class="text-sm text-destructive">{{ durableSettingsError }}</p>
        <p class="text-xs text-muted-foreground">Экспорт содержит исходные записи; вложения не считаются скачанными файлами. Захват можно безопасно повторить после остановки.</p>
      </section>
    </div>
    <div
      :id="tabPrefix + '-panel-reader'"
      v-show="tab === 'reader'"
      role="tabpanel"
      :aria-labelledby="tabPrefix + '-tab-reader'"
      tabindex="0"
      class="flex min-w-0 flex-col gap-3"
    >
      <section class="booster-stack-card" aria-label="Reader Dexie">
        <div class="booster-setting-copy">
          <b>Сообщения из Dexie</b>
          <span>Чтение только текущей подтверждённой VK-переписки. До 80 записей на страницу.</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !hasVerifiedPeer" @click="readDexie()">Открыть Reader</Button>
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !fixedNextCursor" @click="readDexie(fixedNextCursor)">Следующие 80</Button>
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !fixedCursor" @click="readDexie()">К началу</Button>
        </div>
        <ol class="max-h-96 overflow-y-auto space-y-2" aria-label="Сохранённые сообщения">
          <li v-for="message in fixedPreview" :key="message.id" class="border-b border-border py-2">
            <b>Сообщение {{ message.id }}</b>
            <p class="whitespace-pre-wrap break-words">{{ message.text || 'Без текста' }}</p>
            <small v-if="message.attachments?.length">Вложений в исходных данных: {{ message.attachments.length }}</small>
          </li>
        </ol>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ fixedError }}</p>
      </section>
    </div>
    <div
      :id="tabPrefix + '-panel-settings'"
      v-show="tab === 'settings'"
      role="tabpanel"
      :aria-labelledby="tabPrefix + '-tab-settings'"
      tabindex="0"
      class="flex min-w-0 flex-col gap-3"
    >
      <section v-if="api && status" class="booster-stack-card" aria-label="Профиль параметров VK">
        <div class="booster-setting-copy">
          <b>Постоянные параметры и резервная копия</b>
          <small>
            Режим, количество, диапазон дат, размер пачки и медиа хранятся отдельно от архива.
            При перезапуске они восстанавливаются автоматически; JSON создаёт переносимую резервную копию только этих параметров.
            Сообщения, токены, ID диалога и данные папки не сохраняются.
          </small>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="preferencesBusy || status.busy || status.folderPending || !!status.blockedReason"
            @click="downloadPreferences"
          >Сохранить профиль JSON</Button>
          <label class="booster-field min-w-0 flex-1">
            <span>Восстановить параметры из JSON</span>
            <input
              type="file"
              class="booster-input w-full"
              accept=".json,application/json"
              :disabled="preferencesBusy || status.busy || status.folderPending || !!status.blockedReason"
              @change="selectPreferences"
            />
          </label>
        </div>
        <label v-if="preferencesFile" class="booster-field">
          <span class="flex items-center gap-2">
            <input v-model="preferencesConfirmed" type="checkbox" :disabled="preferencesBusy" />
            Подтверждаю замену сохранённых и текущих параметров
          </span>
        </label>
        <Button
          v-if="preferencesFile"
          variant="outline"
          size="sm"
          :disabled="preferencesBusy || status.busy || status.folderPending || !!status.blockedReason || !preferencesConfirmed"
          @click="importPreferences"
        >Применить профиль</Button>
        <p v-if="durableSettingsError" role="alert" class="m-0 text-sm text-destructive">{{ durableSettingsError }}</p>
        <p v-if="preferencesError" role="alert" class="m-0 text-sm text-destructive">{{ preferencesError }}</p>
        <p v-if="preferencesMessage" role="status" class="m-0 text-sm">{{ preferencesMessage }}</p>
      </section>
    </div>
  </section>
</template>
