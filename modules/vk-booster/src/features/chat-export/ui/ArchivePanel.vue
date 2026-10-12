<script setup lang="ts">
/** VK-only archive API adapter. Generic ArchiveManager owns presentation, never VK storage. */

import type { ChatCollectionSnapshot } from '@kobaproduction/browser-archive'
import { createChatCollectionController, readArchiveMedia } from '@kobaproduction/browser-archive'
import { Badge, Button } from '@kobaproduction/browser-ui'
import {
  ArchiveMessageHeader,
  ArchiveProgressBar,
  ConversationCollectionAction,
  useApplicationTelemetry,
} from '@kobaproduction/browser-widgets'
import { Archive, Download, LoaderCircle, Settings2, ShieldAlert } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { assets } from '../api/vk-media'
import { vkArchiveErrorMessage } from '../model/archive-error-feedback'
import { vkChatCollectionPort } from '../model/chat-collection-port'
import { vkPreferencesLoadError, vkPreferencesPersistence } from '../model/durable-preferences'
import { validateVkCapturePreferences } from '../model/settings-backup'
import type { VkAsset } from '../model/types'
import { type ArchiveStatus, archiveApi, type VkMessage } from '../model/types'
import { vkRequestedView } from '../model/ui-navigation'
import type { VkExportProgress } from '../model/vk-user-export'

const api = archiveApi()
const telemetry = useApplicationTelemetry()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
const error = ref('')
type View = 'capture' | 'reader' | 'settings'
const tab = ref<View>('capture')
const tabPrefix = useId()
const selectedStatus = computed(() => {
  if (activeOperation.value === 'export') return 'Экспорт архива'
  if (status.value?.busy || fixedBusy.value) return 'Захват сообщений'
  if (status.value?.blockedReason)
    return status.value.activePeerId ? 'Другой диалог' : 'Открой переписку'
  return status.value?.activePeerId ? 'Dexie v1' : 'Открой переписку'
})
const fixedBusy = ref(false)
const activeOperation = ref<'capture' | 'export' | null>(null)
const captureRange = ref<'all' | 'recent'>('all')
const fixedLimit = ref(Math.min(100000, Math.max(1, status.value?.options.limit ?? 100)))
const requestPageSize = ref(status.value?.options.pageSize ?? 50)
const requestDelay = ref(status.value?.options.delay ?? 450)
const captureComplete = ref<boolean | null>(null)
const reportedTotal = ref<number | null>(null)
const attachmentReferences = ref<number | null>(null)
const collector = api
  ? createChatCollectionController(
      vkChatCollectionPort(api, () => (captureRange.value === 'all' ? 'all' : fixedLimit.value)),
    )
  : null
const collectionState = ref<ChatCollectionSnapshot>(
  collector?.snapshot() ?? {
    phase: 'idle',
    processed: 0,
    total: null,
    saved: null,
  },
)
const unsubscribeCollection = collector?.subscribe((next) => {
  collectionState.value = next
})
onUnmounted(() => {
  unsubscribeCollection?.()
  collector?.dispose()
})
const fixedSaved = ref<number | null>(null)
const fixedError = ref('')
const fixedPreview = ref<readonly VkMessage[]>([])
const fixedCursor = ref<number | undefined>()
const fixedNextCursor = ref<number | undefined>()
const fixedReading = ref(false)
let readerGeneration = 0
const participantNames = ref<Record<number, string>>({})
const nameLookupError = ref('')
const attachments = ref<Record<string, { blob: Blob; url: string; name: string }>>({})
const downloading = ref<Record<string, boolean>>({})
const attachmentErrors = ref<Record<string, string>>({})
const exportOpen = ref(false)
const exportChunkRows = ref<100 | 500>(500)
const exportIncludeReferences = ref(true)
const exportPrepared = ref<Blob | null>(null)
const exportProgress = ref<VkExportProgress | null>(null)
function senderName(message: VkMessage): string {
  const id = message.from_id
  if (typeof id === 'number') {
    const name = participantNames.value[id]
    if (name) return name
  }
  if (message.out === 1 || message.out === true) return 'Вы'
  return id && Number.isSafeInteger(id) ? `Участник ${id} (имя не получено)` : 'Неизвестный отправитель'
}
function messageMedia(message: VkMessage): VkAsset[] {
  return assets(message).filter((item) => item.type !== 'link')
}
async function requestMedia(asset: VkAsset) {
  if (downloading.value[asset.key] || attachments.value[asset.key] || !hasVerifiedPeer.value) return
  downloading.value = { ...downloading.value, [asset.key]: true }
  const peer = api?.status().activePeerId
  attachmentErrors.value = { ...attachmentErrors.value, [asset.key]: '' }
  try {
    const first = asset.choices.find((item) => /^https:\/\//i.test(item.url))
    if (!first) throw Error('Нет доступной HTTPS-ссылки для вложения.')
    const response = await fetch(first.url, { credentials: 'omit', signal: AbortSignal.timeout(30000) })
    const result = await readArchiveMedia(response, {
      maxBytes: 64 * 1024 * 1024,
      expectedBytes: first.size,
    })
    if (!peer || api?.status().activePeerId !== peer) throw Error('Переписка изменилась.')
    const blob = new Blob([result.bytes], { type: result.mime })
    attachments.value = {
      ...attachments.value,
      [asset.key]: {
        blob,
        url: URL.createObjectURL(blob),
        name: first.name,
      },
    }
  } catch {
    attachmentErrors.value = {
      ...attachmentErrors.value,
      [asset.key]: 'Не удалось загрузить оригинал. Ссылка может быть недоступна или истекла.',
    }
  } finally {
    downloading.value = { ...downloading.value, [asset.key]: false }
  }
}
function resetPreparedExport() {
  exportPrepared.value = null
  exportProgress.value = null
}
function showUserExportOptions() {
  exportOpen.value = true
  resetPreparedExport()
}

const hasVerifiedPeer = computed(() => !!status.value?.activePeerId && !status.value?.blockedReason)
async function persistCaptureOptions() {
  if (!api) throw Error('VK unavailable')
  // ArchiveOptions includes peerId, which must never enter the persisted
  // seven-field preferences envelope (strictly validated below).
  const { mode, from, through, media } = api.status().options
  const options = validateVkCapturePreferences({
    mode,
    limit: fixedLimit.value,
    from,
    through,
    pageSize: requestPageSize.value,
    delay: requestDelay.value,
    media,
  })
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
async function saveCaptureOptions() {
  if (!api || fixedBusy.value) return
  try {
    await persistCaptureOptions()
  } catch {
    fixedError.value = 'Проверь количество сообщений, размер пачки и задержку.'
  }
}
async function captureDexie() {
  if (!api || fixedBusy.value || !hasVerifiedPeer.value) return
  fixedBusy.value = true
  resetPreparedExport()
  void telemetry?.record('archive.capture.started')
  activeOperation.value = 'capture'
  fixedError.value = ''
  try {
    await persistCaptureOptions()
    if (!collector) throw Error('VK collector unavailable')
    await collector.start()
    const latest = api.status()
    fixedSaved.value = latest.progress.newCount ?? null
    void telemetry?.record('archive.capture.completed', latest.progress.newCount ?? 0)
    reportedTotal.value = latest.progress.total || null
    captureComplete.value = latest.progress.phase === 'Dexie: сохранено'
    attachmentReferences.value = latest.progress.attachmentReferences ?? null
    fixedPreview.value = []
    fixedCursor.value = undefined
    fixedNextCursor.value = undefined
  } catch (error) {
    void telemetry?.record('archive.capture.failed')
    captureComplete.value = false
    fixedError.value = `Сбор прерван. ${vkArchiveErrorMessage(error)}`
  } finally {
    activeOperation.value = null
    fixedBusy.value = false
  }
}
async function readDexie(cursor?: number) {
  if (!api || fixedBusy.value || fixedReading.value || !hasVerifiedPeer.value) return
  fixedReading.value = true
  fixedError.value = ''
  const ticket = ++readerGeneration
  const peer = api.status().activePeerId
  try {
    const rows = await api.readFixed(80, cursor)
    if (ticket !== readerGeneration || api.status().activePeerId !== peer) return
    fixedPreview.value = rows
    fixedCursor.value = cursor
    fixedNextCursor.value = rows.length === 80 ? rows.at(-1)?.id : undefined
    fixedReading.value = false
    // Names are fetched separately. An unavailable VK users.get cannot
    // delay the saved transcript or erase records from the Reader.
    const ids = [
      ...new Set(
        rows
          .map((row) => row.from_id)
          .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0),
      ),
    ]
    void api
      .resolveParticipants(ids)
      .then((people) => {
        if (ticket !== readerGeneration || api.status().activePeerId !== peer) return
        participantNames.value = Object.fromEntries(people.map((person) => [person.id, person.name]))
        nameLookupError.value =
          ids.length > people.length
            ? 'Часть имён VK не предоставил. Идентификаторы показаны без подмены.'
            : ''
      })
      .catch(() => {
        if (ticket === readerGeneration && api.status().activePeerId === peer)
          nameLookupError.value = 'VK не предоставил имена участников. Сообщения сохранены и доступны.'
      })
  } catch (error) {
    if (ticket === readerGeneration) {
      fixedPreview.value = []
      fixedCursor.value = undefined
      fixedNextCursor.value = undefined
      fixedError.value = `Чтение: ${vkArchiveErrorMessage(error)}`
    }
  } finally {
    if (ticket === readerGeneration) fixedReading.value = false
  }
}
async function prepareUserZip() {
  if (!api || fixedBusy.value || !hasVerifiedPeer.value || !exportOpen.value) return
  fixedBusy.value = true
  activeOperation.value = 'export'
  fixedError.value = ''
  resetPreparedExport()
  try {
    const loaded = Object.entries(attachments.value).map(([key, value]) => ({
      key,
      name: value.name,
      blob: value.blob,
    }))
    const result = await api.exportUserZip(
      {
        chunkRows: exportChunkRows.value,
        includeReferences: exportIncludeReferences.value,
        downloadedMedia: loaded,
      },
      (progress) => {
        exportProgress.value = progress
      },
    )
    if (!result.size) throw Error('ZIP export returned an empty archive')
    exportPrepared.value = result
    void telemetry?.record('archive.export.completed')
  } catch (error) {
    void telemetry?.record('archive.export.failed')
    fixedError.value = `Экспорт ZIP: ${vkArchiveErrorMessage(error)}`
  } finally {
    activeOperation.value = null
    fixedBusy.value = false
  }
}
function downloadPreparedZip() {
  const blob = exportPrepared.value
  if (!blob || fixedBusy.value || !hasVerifiedPeer.value) return
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = 'vk-saved-conversation.zip'
    document.body.append(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
function enterTab(view: View) {
  tab.value = view
  if (view === 'reader' && !fixedPreview.value.length && !fixedReading.value && hasVerifiedPeer.value)
    void readDexie()
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
  enterTab(selected.id)
  const target = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(
    '#' + tabPrefix + '-tab-' + selected.id,
  )
  target?.focus()
}
const durableSettingsError = ref(vkPreferencesLoadError())

watch(
  vkRequestedView,
  (requested) => {
    if (!requested) return
    // Navigation commands are one-shot; reopening a view must never replay a
    // full API scan or export just because the last route was 'collect'.
    vkRequestedView.value = null
    if (requested === 'export') {
      enterTab('reader')
      showUserExportOptions()
    } else if (requested === 'collect') {
      tab.value = 'capture'
      void captureDexie()
    } else enterTab(requested)
  },
  { immediate: true },
)
let unsubscribe: (() => void) | undefined
let peerTimer: ReturnType<typeof setInterval> | undefined
function refreshActiveConversation() {
  const next = api?.status()
  if (!next) return
  const previous = status.value
  if (previous?.activePeerId !== next.activePeerId) {
    readerGeneration++
    fixedReading.value = false
    fixedPreview.value = []
    fixedSaved.value = null
    captureComplete.value = null
    reportedTotal.value = null
    attachmentReferences.value = null
    fixedCursor.value = undefined
    fixedNextCursor.value = undefined
    fixedError.value = ''
    nameLookupError.value = ''
    participantNames.value = {}
    for (const file of Object.values(attachments.value)) URL.revokeObjectURL(file.url)
    attachments.value = {}
    resetPreparedExport()
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
  if (tab.value === 'reader' && hasVerifiedPeer.value) void readDexie()
})
onUnmounted(() => {
  unsubscribe?.()
  if (peerTimer !== undefined) clearInterval(peerTimer)
  for (const file of Object.values(attachments.value)) URL.revokeObjectURL(file.url)
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
        @click="enterTab(item.id)"
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
      <section class="booster-stack-card" aria-label="Сбор истории VK">
        <div class="booster-setting-copy">
          <b>1 · История переписки</b>
          <span>Получает сообщения напрямую через VK API, сохраняет оригиналы в Dexie. Работает в открытом проверенном диалоге, без прокрутки сайта.</span>
        </div>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Объём выгрузки">
          <Button type="button" size="sm" :variant="captureRange === 'all' ? 'default' : 'outline'"
            :aria-pressed="captureRange === 'all'" :disabled="fixedBusy" @click="captureRange = 'all'">Вся история</Button>
          <Button type="button" size="sm" :variant="captureRange === 'recent' ? 'default' : 'outline'"
            :aria-pressed="captureRange === 'recent'" :disabled="fixedBusy" @click="captureRange = 'recent'">Последние N</Button>
        </div>
        <label v-if="captureRange === 'recent'" class="booster-field">Сообщений (1–100 000)
          <input v-model.number="fixedLimit" class="booster-input" type="number" min="1" max="100000" :disabled="fixedBusy" @change="saveCaptureOptions" />
        </label>
        <p v-else class="text-xs text-muted-foreground">Без искусственного ограничения в 3000 сообщений. VK может ограничивать частоту API-запросов; при необходимости автоматически делаются паузы.</p>
        <details class="booster-collection-advanced rounded-md border border-border p-3 text-sm" :open="false">
          <summary class="cursor-pointer select-none font-medium text-sm">Скорость и размер запросов</summary>
          <label class="booster-field">Сообщений за запрос <b>{{ requestPageSize }}</b>
            <input v-model.number="requestPageSize" type="range" class="w-full accent-primary" min="10" max="100" step="10" :disabled="fixedBusy" @change="saveCaptureOptions" />
          </label>
          <label class="booster-field">Пауза между запросами <b>{{ requestDelay }} мс</b>
            <input v-model.number="requestDelay" type="range" class="w-full accent-primary" min="300" max="3000" step="50" :disabled="fixedBusy" @change="saveCaptureOptions" />
          </label>
          <small>При ограничении скорости VK запрос повторяется с увеличенной паузой. Значения сохраняются при отпускании слайдера.</small>
        </details>
        <ConversationCollectionAction :label="captureRange === 'all' ? 'Собрать всю историю' : 'Собрать последние сообщения'"
          :busy="fixedBusy" :disabled="!hasVerifiedPeer"
          :processed="collectionState.processed" :total="collectionState.total"
          :saved="collectionState.saved" @start="captureDexie" @stop="collector?.stop()" />
        <p v-if="!hasVerifiedPeer" class="text-sm text-muted-foreground">Открой конкретную VK-переписку — на остальных страницах сайта доступны настройки и меню.</p>
        <p v-if="fixedSaved !== null" role="status" class="text-sm">
          Сохранено новых: {{ fixedSaved }}. Обработано: {{ collectionState.processed }}{{ reportedTotal !== null ? ` из ${reportedTotal}` : '' }}.
          {{ captureComplete ? 'Обход доступной истории завершён.' : 'Обход частичный: можно продолжить повторным сбором.' }}
        </p>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ fixedError }}</p>
        <p v-if="durableSettingsError" role="alert" class="text-sm text-destructive">{{ durableSettingsError }}</p>
      </section>
      <section class="booster-stack-card" aria-label="Догрузка вложений">
        <div class="booster-setting-copy">
          <b>2 · Вложения и файлы</b>
          <span>После сохранения сообщений можно будет догружать оригинальные файлы отдельной задачей с возобновлением. Пока Dexie сохраняет только метаданные и ссылки; бинарные файлы не скачаны.</span>
          <small v-if="attachmentReferences !== null">Ссылок на вложения верхнего уровня в обработанной истории: {{ attachmentReferences }}. Скачано оригинальных файлов: 0.</small>
        </div>
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
          <b>Сохранённая переписка</b>
          <span>Автор, дата и направление сообщений показаны сразу. Подробные исходные метаданные доступны по значку информации.</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !hasVerifiedPeer" @click="readDexie()">
            <LoaderCircle v-if="fixedReading" class="size-4 animate-spin" aria-hidden="true" />
            {{ fixedReading ? 'Чтение...' : 'Обновить Reader' }}
          </Button>
          <Button variant="outline" :disabled="fixedBusy || !hasVerifiedPeer" @click="showUserExportOptions">
            Экспорт ZIP · параметры
          </Button>
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !fixedNextCursor" @click="readDexie(fixedNextCursor)">Следующие 80</Button>
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !fixedCursor" @click="readDexie()">К началу</Button>
        </div>
        <p v-if="fixedReading" class="text-sm text-muted-foreground" role="status">Загружаем сохранённые сообщения...</p>
        <p v-if="!fixedReading && !fixedPreview.length" class="text-sm text-muted-foreground" role="status">
          В этом диалоге ещё нет сохранённых сообщений или Reader недоступен.
        </p>
        <p v-if="nameLookupError" class="text-xs text-muted-foreground">{{ nameLookupError }}</p>
        <div aria-label="Сохранённые сообщения" class="max-h-[min(65vh,560px)] min-w-0 overflow-y-auto space-y-3 p-2">
          <article
            v-for="message in fixedPreview"
            :key="message.id"
            class="flex min-w-0"
            :class="message.out === 1 || message.out === true ? 'justify-end' : 'justify-start'"
          >
            <div class="min-w-0 max-w-[88%] rounded-lg border border-border p-3"
              :class="message.out === 1 || message.out === true ? 'bg-primary/10' : 'bg-muted/45'">
              <ArchiveMessageHeader :author="senderName(message)" :sent-at="message.date"
                :metadata="message" inspect-label="Все исходные метаданные сообщения" />
              <p v-if="message.text" class="mt-2 whitespace-pre-wrap break-words text-sm">{{ message.text }}</p>
              <p v-else class="mt-2 text-xs text-muted-foreground">Сообщение без текста</p>
              <div v-for="asset in messageMedia(message)" :key="asset.key" class="mt-2 flex min-w-0 flex-col gap-1 border-t border-border pt-2">
                <img v-if="asset.type === 'photo' && attachments[asset.key]"
                  :src="attachments[asset.key]?.url" :alt="attachments[asset.key]?.name || 'Фото из сообщения'"
                  class="max-h-64 max-w-full rounded-md object-contain" loading="lazy" referrerpolicy="no-referrer" />
                <small class="break-words text-muted-foreground">{{ asset.type }} · {{ asset.choices[0]?.name || 'Вложение' }}
                  · {{ attachments[asset.key] ? 'загружено в текущем сеансе' : 'оригинал не загружен' }}</small>
                <Button v-if="!attachments[asset.key]" size="sm" variant="outline"
                  :disabled="downloading[asset.key] || !hasVerifiedPeer" @click="requestMedia(asset)">
                  <LoaderCircle v-if="downloading[asset.key]" class="size-3.5 animate-spin" aria-hidden="true" />
                  {{ downloading[asset.key] ? 'Загрузка...' : 'Загрузить оригинал' }}
                </Button>
                <a v-else :href="attachments[asset.key]?.url" :download="attachments[asset.key]?.name"
                  class="text-xs text-primary underline underline-offset-2">Скачать загруженный файл</a>
                <small v-if="attachmentErrors[asset.key]" class="text-destructive" role="alert">{{ attachmentErrors[asset.key] }}</small>
              </div>
            </div>
          </article>
        </div>
        <p v-if="fixedError" role="alert" class="text-sm text-destructive">{{ fixedError }}</p>
      </section>
      <section v-if="exportOpen" class="booster-stack-card" aria-label="Параметры пользовательского экспорта ZIP">
        <div class="booster-setting-copy">
          <b>Экспорт сообщений в ZIP</b>
          <span>Отдельно от резервного бэкапа TAR.GZ. В ZIP войдут все уже сохранённые сообщения с оригинальными метаданными.</span>
          <small>Полнота удалённой истории не подтверждается автоматически; исходные файлы включаются только после их явной загрузки.</small>
        </div>
        <label class="booster-field">Сообщений в одном JSON-файле
          <select v-model.number="exportChunkRows" class="booster-input" :disabled="fixedBusy" @change="resetPreparedExport">
            <option :value="100">100</option>
            <option :value="500">500</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="exportIncludeReferences" type="checkbox" :disabled="fixedBusy" @change="resetPreparedExport" />
          Добавить manifest вложений в папку attachments/
        </label>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="fixedBusy || !hasVerifiedPeer" @click="prepareUserZip">
            <LoaderCircle v-if="fixedBusy" class="size-4 animate-spin" aria-hidden="true" />
            {{ fixedBusy ? 'Подготавливаем ZIP...' : 'Подготовить ZIP' }}
          </Button>
          <Button v-if="exportPrepared" variant="outline" :disabled="fixedBusy" @click="downloadPreparedZip">
            Скачать ZIP · {{ Math.ceil(exportPrepared.size / 1024) }} КиБ
          </Button>
          <Button size="sm" variant="ghost" @click="exportOpen = false">Закрыть параметры</Button>
        </div>
        <ArchiveProgressBar v-if="exportProgress" :label="exportProgress.phase === 'reading' ? 'Читаем Dexie' : 'Упаковываем ZIP'"
          :percent="exportProgress.total ? Math.round(exportProgress.done / exportProgress.total * 100) : null"
          :counter="`${exportProgress.done} из ${exportProgress.total}`" />
        <p v-if="exportPrepared" role="status" class="text-sm">ZIP подготовлен. Файл сохранится только после нажатия «Скачать ZIP».</p>
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
      <section class="booster-stack-card" aria-label="Постоянные параметры VK">
        <div class="booster-setting-copy">
          <b>Параметры сохранения</b>
          <small>Размер пачки, пауза и число сообщений сохраняются при изменении и восстанавливаются при следующем запуске.</small>
        </div>
        <label class="booster-field">Последние N сообщений
          <input v-model.number="fixedLimit" type="number" min="1" max="100000"
            class="booster-input" :disabled="fixedBusy" @change="saveCaptureOptions" />
        </label>
        <label class="booster-field">Размер запроса VK: {{ requestPageSize }}
          <input v-model.number="requestPageSize" type="range" min="10" max="100" step="10"
            class="w-full accent-primary" :disabled="fixedBusy" @change="saveCaptureOptions" />
        </label>
        <label class="booster-field">Пауза между страницами: {{ requestDelay }} мс
          <input v-model.number="requestDelay" type="range" min="300" max="3000" step="50"
            class="w-full accent-primary" :disabled="fixedBusy" @change="saveCaptureOptions" />
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" :disabled="fixedBusy" @click="saveCaptureOptions">
            Сохранить параметры
          </Button>
          <small class="text-muted-foreground">Сохраняются отдельно от сообщений Dexie и не включают токены.</small>
        </div>
        <p v-if="durableSettingsError" role="alert" class="m-0 text-sm text-destructive">{{ durableSettingsError }}</p>
      </section>
    </div>
  </section>
</template>
