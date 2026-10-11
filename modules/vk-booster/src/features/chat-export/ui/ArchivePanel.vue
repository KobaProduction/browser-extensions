<script setup lang="ts">
/** VK-only archive API adapter. Generic ArchiveManager owns presentation, never VK storage. */

import { Badge, Button } from '@kobaproduction/browser-ui'
import { ArchiveManager, type ArchiveManagerOptions } from '@kobaproduction/browser-widgets'
import { Archive, Download, Settings2, ShieldAlert } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import { presentVkArchive } from '../model/archive-presentation'
import { vkPreferencesLoadError, vkPreferencesPersistence } from '../model/durable-preferences'
import {
  exportVkCaptureSettings,
  restoreVkCaptureSettings,
  validateVkCapturePreferences,
} from '../model/settings-backup'
import { type ArchiveStatus, archiveApi } from '../model/types'
import ArchivePreview from './ArchivePreview.vue'

const api = archiveApi()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
const error = ref('')
type View = 'capture' | 'reader' | 'settings'
const tab = ref<View>('capture')
const tabPrefix = useId()
const selectedStatus = computed(() => {
  const current = status.value
  if (!current) return 'Инициализация'
  if (current.blockedReason) return 'Другой диалог'
  if (current.folderPending) return 'Выбор папки'
  if (current.busy) return 'Выгрузка'
  if (current.checkpoint?.status === 'paused') return 'Приостановлено'
  return current.folder ? 'Папка подключена' : 'Папка не выбрана'
})
const presentation = computed(() => (status.value ? presentVkArchive(status.value) : null))
const visibleSummary = computed(() => presentation.value?.summary ?? null)
const canReadArchive = computed(() => presentation.value?.canRead ?? false)
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
const preferencesRevision = ref(0)
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
    preferencesRevision.value++
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
  if (
    !previous ||
    next.activePeerId !== previous.activePeerId ||
    next.blockedReason !== previous.blockedReason ||
    next.options.peerId !== previous.options.peerId
  )
    status.value = next
}
const view = computed(() => presentation.value?.manager ?? null)
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
    // Save the user's validated capture defaults independently of the archive sink.
    const port = vkPreferencesPersistence()
    try {
      if (!port) throw Error('Постоянное хранилище VK недоступно')
      await port.write(validateVkCapturePreferences(options))
      durableSettingsError.value = ''
    } catch {
      // A storage quota/permission failure must not prevent authorized VK capture.
      durableSettingsError.value = 'Не удалось сохранить параметры для следующего запуска.'
    }
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
        <span v-if="visibleSummary" class="break-all">
          {{ visibleSummary.folder }} · Сообщений: {{ visibleSummary.messages }}
        </span>
        <span v-else>История переписки хранится в выбранной папке на этом устройстве.</span>
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
    <!-- v-show keeps the archive form and its progress in memory across tab
         switches; importing a validated preset explicitly remounts it. -->
    <div
      :id="tabPrefix + '-panel-capture'"
      v-show="tab === 'capture'"
      role="tabpanel"
      :aria-labelledby="tabPrefix + '-tab-capture'"
      tabindex="0"
      class="flex min-w-0 flex-col gap-3"
    >
      <ArchiveManager
        v-if="status && view"
        :key="preferencesRevision"
        :state="view"
        :initial="status.options"
        :error="visibleSummary ? error : ''"
        title="Выгрузка VK Archive v1"
        @choose-folder="chooseFolder"
        @start="start"
        @stop="api?.stop()"
        @resume="resume"
      />
      <section v-else class="booster-setting-card" role="status">
        <span>VK Archive v1 ещё не инициализирован.</span>
      </section>
      <p class="m-0 text-xs text-muted-foreground">
        Параметры выгрузки сохраняются на этом устройстве при запуске и при восстановлении JSON-профиля.
        Повторная выгрузка сохраняет существующие сообщения, чекпоинты и файлы.
        Для проверки ранее сохранённых вложений используется их SHA-256, если он известен.
      </p>
    </div>
    <div
      :id="tabPrefix + '-panel-reader'"
      v-show="tab === 'reader'"
      role="tabpanel"
      :aria-labelledby="tabPrefix + '-tab-reader'"
      tabindex="0"
      class="flex min-w-0 flex-col gap-3"
    >
      <ArchivePreview v-if="api && status && canReadArchive" :api="api" :status="status" />
      <section v-else class="booster-stack-card" role="status">
        <div class="booster-setting-copy">
          <b>Просмотр локальных сообщений</b>
          <span v-if="status?.blockedReason">Выбранный архив относится к другому диалогу. Его содержимое скрыто.</span>
          <span v-else-if="status?.folderPending">Выбор папки ещё не завершён.</span>
          <span v-else>Выбери папку и сохрани сообщения на вкладке «Выгрузка».</span>
        </div>
        <Button variant="outline" size="sm" @click="tab = 'capture'">Открыть выгрузку</Button>
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
      <section class="booster-stack-card">
        <div class="booster-setting-copy">
          <b>Архив и восстановление</b>
          <span>Backup/restore сообщений и вложений — отдельный механизм, зависящий от будущего канонического архива Dexie. Эта кнопка сохраняет только настройки.</span>
        </div>
        <p class="m-0 text-xs text-muted-foreground">
          Для сохранения архива используй папку с metadata.json, messages.json,
          index.html и media/. Переносить её данные между DEV, PROD и All-in-one
          автоматически нельзя.
        </p>
      </section>
    </div>
  </section>
</template>
