<script setup lang="ts">
/** VK-only archive API adapter. Generic ArchiveManager owns presentation, never VK storage. */

import type { ChatCollectionSnapshot } from '@kobaproduction/browser-archive'
import { createChatCollectionController } from '@kobaproduction/browser-archive'
import { Badge, Button } from '@kobaproduction/browser-ui'
import { ConversationCollectionAction } from '@kobaproduction/browser-widgets'
import { Archive, Download, Settings2, ShieldAlert } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { vkChatCollectionPort } from '../model/chat-collection-port'
import { vkPreferencesLoadError, vkPreferencesPersistence } from '../model/durable-preferences'
import { validateVkCapturePreferences } from '../model/settings-backup'
import { type ArchiveStatus, archiveApi, type VkMessage } from '../model/types'
import { vkRequestedView } from '../model/ui-navigation'

const api = archiveApi()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
const error = ref('')
type View = 'capture' | 'reader' | 'settings'
const tab = ref<View>('capture')
const tabPrefix = useId()
const selectedStatus = computed(() => {
  if (status.value?.busy || fixedBusy.value) return 'Захват сообщений'
  if (status.value?.blockedReason)
    return status.value.activePeerId ? 'Другой диалог' : 'Открой переписку'
  return status.value?.activePeerId ? 'Dexie v1' : 'Открой переписку'
})
const fixedBusy = ref(false)
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
const hasVerifiedPeer = computed(() => !!status.value?.activePeerId && !status.value?.blockedReason)
async function persistCaptureOptions() {
  if (!api) throw Error('VK unavailable')
  const options = validateVkCapturePreferences({
    ...api.status().options,
    limit: fixedLimit.value,
    pageSize: requestPageSize.value,
    delay: requestDelay.value,
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
  fixedError.value = ''
  try {
    await persistCaptureOptions()
    if (!collector) throw Error('VK collector unavailable')
    await collector.start()
    const latest = api.status()
    fixedSaved.value = latest.progress.newCount ?? null
    reportedTotal.value = latest.progress.total || null
    captureComplete.value = latest.progress.phase === 'Dexie: сохранено'
    attachmentReferences.value = latest.progress.attachmentReferences ?? null
    fixedPreview.value = []
    fixedCursor.value = undefined
    fixedNextCursor.value = undefined
  } catch {
    captureComplete.value = false
    fixedError.value = 'Сбор прерван. Сохранённые сообщения остаются в Dexie — можно повторить операцию.'
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
const durableSettingsError = ref(vkPreferencesLoadError())

watch(
  vkRequestedView,
  (requested) => {
    if (!requested) return
    // Navigation commands are one-shot; reopening a view must never replay a
    // full API scan or export just because the last route was 'collect'.
    vkRequestedView.value = null
    if (requested === 'export') {
      tab.value = 'reader'
      void exportDexie()
    } else if (requested === 'collect') {
      tab.value = 'capture'
      void captureDexie()
    } else tab.value = requested
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
    fixedPreview.value = []
    fixedSaved.value = null
    captureComplete.value = null
    reportedTotal.value = null
    attachmentReferences.value = null
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
          <b>Сообщения из Dexie</b>
          <span>Чтение только текущей подтверждённой VK-переписки. До 80 записей на страницу.</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" :disabled="fixedBusy || fixedReading || !hasVerifiedPeer" @click="readDexie()">Открыть Reader</Button>
          <Button variant="outline" :disabled="fixedBusy || !hasVerifiedPeer" @click="exportDexie">Экспорт JSONL.gz</Button>
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
      <section class="booster-stack-card" aria-label="Постоянные параметры VK">
        <div class="booster-setting-copy">
          <b>Параметры сохранения</b>
          <small>Размер пачки, пауза и число сообщений сохраняются при изменении и восстанавливаются при следующем запуске.</small>
        </div>
        <p v-if="durableSettingsError" role="alert" class="m-0 text-sm text-destructive">{{ durableSettingsError }}</p>
      </section>
    </div>
  </section>
</template>
