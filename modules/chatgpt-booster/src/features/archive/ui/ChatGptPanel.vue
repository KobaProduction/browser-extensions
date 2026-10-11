<script setup lang="ts">
import {
  ARCHIVE_SOURCE_INCOMPATIBLE_EVENT,
  ARCHIVE_UPDATED_EVENT,
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
  OPEN_ARCHIVE_EVENT,
  OPEN_CAPTURE_SETTINGS_EVENT,
  OPEN_SETTINGS_EVENT,
  type ArchiveCaptureContext,
  type ArchiveCurrentContext,
  type ArchiveMessageLocation,
  type HistoryLoaderState,
  resolveCaptureRule,
} from '@chatgpt-booster/core'
import { SHELL_CLOSE_EVENT, instanceKey } from '@kobaproduction/browser-core'
import {
  Archive, ArrowUpToLine, Download, Ellipsis, Settings2, ShieldCheck, Square, Wrench,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveBrowser from '../../../../packages/ui/src/ArchiveBrowser.vue'
import CaptureSettingsSurface from '../../../../packages/ui/src/CaptureSettingsSurface.vue'
import ControlCenter from '../../../../packages/ui/src/ControlCenterPanel.vue'
import CopyIdentity from '../../../../packages/ui/src/CopyIdentity.vue'
import { resolveLocale } from '../../../../packages/ui/src/i18n'
import { installBoosterShadowStyles } from '../../../../packages/ui/src/shadow-styles'
import { chatGptRequestedSection, chatGptViewContext } from '../../../index'

type View = 'archive' | 'export' | 'capture' | 'settings'
const tab = ref<View>('archive')
const context = computed(() => chatGptViewContext.value)
const locale = ref<'ru' | 'en'>('ru')
const current = ref<ArchiveCurrentContext>({
  conversationId: null,
  conversationTitle: null,
  projectId: null,
  projectTitle: null,
})
const coverage = ref<Awaited<ReturnType<NonNullable<typeof context.value>['archiveAdapter']['getCoverage']>>>()
const loader = ref<HistoryLoaderState>({
  phase: 'idle',
  conversationId: null,
  knownMessageCount: 0,
  hasOlderServerHistory: null,
  pagesLoaded: 0,
  consecutiveErrors: 0,
})
const loading = ref(false)
const error = ref('')
const selectedChat = ref<{ id: string; title: string | null }>()
const captureContext = ref<ArchiveCaptureContext>()
const exportCapture = ref(false)
const fixedBusy = ref(false)
const fixedError = ref('')
const fixedCount = ref<number | null>(null)
const fixedPreview = ref<readonly { id: string; text: string; coverage: string }[]>([])
async function saveLegacyReadOnly(version: 'v3' | 'v4') {
  const source = context.value?.fixedArchive
  if (!source || !legacyBackupConfirmed.value || legacyBackupBusy.value) return
  legacyBackupBusy.value = true
  legacyBackupError.value = ''
  try {
    const blob = version === 'v3' ? await source.backupLegacyV3() : await source.backupLegacyV4()
    if (!blob.size) throw Error('Empty historical source backup')
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = version === 'v3'
        ? 'chatgpt-booster-0.8.92-native-v3-readonly.jsonl.gz'
        : 'chatgpt-booster-native-v4-readonly.jsonl.gz'
      link.click()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  } catch {
    legacyBackupError.value = tr(
      'Старая база не найдена или снимок не удалось создать. Исходные данные не изменены.',
      'Historical database unavailable or export failed; source remains unchanged.',
    )
  } finally {
    legacyBackupBusy.value = false
  }
}
async function readFixedArchive() {
  const fixed = context.value?.fixedArchive
  if (!fixed || fixedBusy.value) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    const [count, records] = await Promise.all([fixed.savedCurrent(), fixed.listCurrent()])
    if (!alive || fixed !== context.value?.fixedArchive) return
    fixedCount.value = count
    fixedPreview.value = records
  } catch {
    fixedError.value = tr('Dexie-архив недоступен для текущего проверенного владельца.',
      'The fixed Dexie archive is unavailable for the verified account.')
  } finally { fixedBusy.value = false }
}
async function exportSelectedDexie() {
  const fixed = context.value?.fixedArchive
  const selected = selectedChat.value
  if (!fixed || !selected || fixedBusy.value) return
  fixedBusy.value = true
  fixedError.value = ''
  const expectedAccount = context.value?.archiveAdapter.currentAccountId?.()
  try {
    if (!expectedAccount) throw Error('Owner unverified')
    const blob = await fixed.exportConversation(selected.id)
    if (context.value?.archiveAdapter.currentAccountId?.() !== expectedAccount ||
        selectedChat.value?.id !== selected.id)
      throw Error('Account or selected conversation changed during export')
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'chatgpt-fixed-v1-' + selected.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.jsonl.gz'
      link.click()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  } catch {
    fixedError.value = tr('Сохранённый Dexie-архив не экспортирован.',
      'The selected Dexie archive could not be exported.')
  } finally { fixedBusy.value = false }
}
async function exportFixedArchive() {
  const fixed = context.value?.fixedArchive
  if (!fixed || fixedBusy.value || !current.value.conversationId) return
  fixedBusy.value = true
  fixedError.value = ''
  try {
    const blob = await fixed.exportCurrent()
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'chatgpt-fixed-v1-' + current.value.conversationId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.jsonl.gz'
      link.click()
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 30_000) }
  } catch {
    fixedError.value = tr('Экспорт Dexie не удался. Исходные базы не изменены.',
      'Dexie export failed. Original sources were not modified.')
  } finally { fixedBusy.value = false }
}
const maintenanceOpen = ref(false)
const legacyBackupBusy = ref(false)
const legacyBackupConfirmed = ref(false)
const legacyBackupError = ref('')
const archiveMenuOpen = ref(false)
const archiveMenuArea = ref<HTMLElement | null>(null)
const archiveInitial = ref<string | null>(null)
const navigationTarget = ref<ArchiveMessageLocation | null>(null)
const returnToExport = ref(false)
const currentSettings = ref<Awaited<ReturnType<NonNullable<typeof context.value>['settingsAdapter']['get']>>>()
let alive = true
let contextRevision = 0
let activeOwner: string | null = null
let unsubscribeContext: (() => void) | undefined
let unsubscribeSettings: (() => void) | undefined

const active = computed(() =>
  ['preparing', 'scrolling', 'waiting_for_load', 'backoff', 'saving'].includes(loader.value.phase) &&
  loader.value.conversationId === current.value.conversationId,
)
const captureResolution = computed(() =>
  currentSettings.value && current.value.conversationId
    ? resolveCaptureRule(
        currentSettings.value.archive,
        current.value.conversationId,
        current.value.projectId,
      )
    : null,
)
const captureActive = computed(() =>
  !!currentSettings.value?.enabled && !!captureResolution.value?.rule.enabled,
)
const captureTarget = computed<ArchiveCaptureContext | undefined>(() => {
  const chat = current.value
  if (!chat.conversationId) return undefined
  if (captureResolution.value?.source !== 'conversation' && chat.projectId) {
    return { scope: 'project', id: chat.projectId, title: chat.projectTitle }
  }
  return {
    scope: 'conversation',
    id: chat.conversationId,
    title: chat.conversationTitle,
    projectId: chat.projectId,
  }
})
const tr = (ru: string, en: string) => locale.value === 'ru' ? ru : en

async function refreshContext() {
  const adapter = context.value?.archiveAdapter
  if (!adapter) return
  const revision = ++contextRevision
  const conversationId = adapter.currentConversationId()
  const accountId = adapter.currentAccountId?.() ?? null
  if (conversationId !== current.value.conversationId || accountId !== activeOwner) {
    activeOwner = accountId
    current.value = {
      conversationId,
      conversationTitle: null,
      projectId: adapter.currentProjectId(),
      projectTitle: null,
    }
    coverage.value = undefined
    fixedCount.value = null
    fixedPreview.value = []
    fixedError.value = ''
    captureContext.value = undefined
  }
  loading.value = true
  try {
    const [info, stats] = await Promise.all([
      adapter.getCurrentContext(),
      conversationId ? adapter.getCoverage(conversationId) : Promise.resolve(undefined),
    ])
    if (!alive || revision !== contextRevision ||
        adapter !== context.value?.archiveAdapter ||
        adapter.currentConversationId() !== conversationId ||
        (adapter.currentAccountId?.() ?? null) !== accountId) return
    current.value = info
    coverage.value = stats
    error.value = conversationId && adapter.hasIncompatibleSource?.(conversationId)
      ? tr('Неподдерживаемый источник диалога: сохранённые данные не изменены.',
        'Unsupported conversation source: saved data was not changed.')
      : ''
  } catch {
    if (alive && revision === contextRevision)
      error.value = tr('Не удалось прочитать текущий диалог. Сохранённый архив не сбрасывался.',
        'Unable to inspect the current conversation. The archive was not reset.')
  } finally {
    if (alive && revision === contextRevision) loading.value = false
  }
}
async function initializeContext() {
  const adapters = context.value
  unsubscribeContext?.()
  unsubscribeSettings?.()
  if (!adapters) return
  try {
    const settings = await adapters.settingsAdapter.get()
    if (!alive || adapters !== context.value) return
    currentSettings.value = settings
    locale.value = resolveLocale(settings.language) === 'en' ? 'en' : 'ru'
    unsubscribeSettings = adapters.settingsAdapter.subscribe((next) => {
      currentSettings.value = next
      locale.value = resolveLocale(next.language) === 'en' ? 'en' : 'ru'
    })
    loader.value = adapters.archiveAdapter.getCollectionState?.() ?? loader.value
    unsubscribeContext = adapters.archiveAdapter.subscribeContextChange?.(() => {
      void refreshContext()
    })
    await refreshContext()
  } catch {
    error.value = tr('Настройки недоступны. Архив не изменён.', 'Settings unavailable. Archive untouched.')
  }
}
function showArchive(id?: string | null, location?: ArchiveMessageLocation) {
  archiveInitial.value = id ?? current.value.conversationId
  navigationTarget.value = location ?? null
  archiveMenuOpen.value = false
  tab.value = 'archive'
}
async function currentExport() {
  const adapter = context.value?.archiveAdapter
  if (!adapter) return
  try {
    const next = await adapter.getCurrentContext()
    if (!alive || !next.conversationId) {
      error.value = tr('Сначала открой диалог для экспорта.', 'Open a conversation before exporting.')
      return
    }
    openExport(next.conversationId, next.conversationTitle)
  } catch {
    error.value = tr('Не удалось получить текущий диалог.', 'Cannot resolve the current conversation.')
  }
}
function openExport(id: string, title: string | null, fromArchive = false) {
  selectedChat.value = { id, title }
  returnToExport.value = fromArchive
  archiveInitial.value = id
  error.value = ''
  tab.value = 'export'
}
function openCapture(scope?: ArchiveCaptureContext, fromExport = false) {
  captureContext.value = scope ?? captureTarget.value
  exportCapture.value = fromExport
  archiveMenuOpen.value = false
  tab.value = 'capture'
}
function endCapture() {
  tab.value = exportCapture.value && selectedChat.value ? 'export' : 'archive'
  exportCapture.value = false
}
async function collect() {
  const adapter = context.value?.archiveAdapter
  if (!adapter || adapter.collectionInsideExportOnly || !current.value.conversationId) return
  error.value = ''
  try {
    await adapter.collectCurrent()
    await refreshContext()
  } catch {
    error.value = tr('Сбор истории не выполнен. Исходные данные сохранены.',
      'History collection failed. Existing data was preserved.')
  }
}
function stopCollection() {
  const adapter = context.value?.archiveAdapter
  const request = {
    ...(loader.value.conversationId ? { conversationId: loader.value.conversationId } : {}),
    ...(loader.value.sessionId !== undefined ? { sessionId: loader.value.sessionId } : {}),
    reason: 'user' as const,
  }
  if (adapter?.stopCollection) adapter.stopCollection(request)
  else window.dispatchEvent(new CustomEvent(HISTORY_LOADER_STOP_EVENT, { detail: request }))
}
function onLoaderState(event: Event) {
  const next = (event as CustomEvent<HistoryLoaderState>).detail
  if (!next || !['idle', 'preparing', 'scrolling', 'waiting_for_load', 'backoff', 'saving', 'complete',
    'cancelled', 'error'].includes(next.phase)) return
  loader.value = { ...next }
  if (next.phase === 'complete' && next.conversationId === current.value.conversationId)
    void refreshContext()
}
function onIncompatible(event: Event) {
  const id = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId
  if (id && id === current.value.conversationId)
    error.value = tr('Исходные данные не изменены: ChatGPT использует другую схему.',
      'Source data not modified: ChatGPT uses an incompatible schema.')
}
function onCaptureRequest(event: Event) {
  const detail = (event as CustomEvent<ArchiveCaptureContext>).detail
  openCapture(detail && (detail.scope === 'project' || detail.scope === 'conversation') ? detail : undefined)
}
function closeMenuOnOutsidePress(event: PointerEvent) {
  if (archiveMenuOpen.value && archiveMenuArea.value &&
      !event.composedPath().includes(archiveMenuArea.value))
    archiveMenuOpen.value = false
}
function closePanel() { window.dispatchEvent(new Event(SHELL_CLOSE_EVENT)) }

watch(context, () => { void initializeContext() }, { immediate: true })
watch(chatGptRequestedSection, (section) => {
  if (section === 'archive') showArchive()
  if (section === 'settings') tab.value = 'settings'
  if (section === 'capture') openCapture()
}, { immediate: true })
onMounted(() => {
  const root = document.getElementById(instanceKey('koba-browser-tools-root'))?.shadowRoot
  if (root) installBoosterShadowStyles(root)
  window.addEventListener('pointerdown', closeMenuOnOutsidePress, true)
  window.addEventListener(OPEN_ARCHIVE_EVENT, onShowArchive)
  window.addEventListener(OPEN_SETTINGS_EVENT, onShowSettings)
  window.addEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCaptureRequest)
  window.addEventListener(HISTORY_LOADER_STATE_EVENT, onLoaderState)
  window.addEventListener(ARCHIVE_UPDATED_EVENT, onArchiveUpdated)
  window.addEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, onIncompatible)
  window.dispatchEvent(new Event('chatgpt-booster:history-loader-query'))
})
function onShowArchive() { showArchive() }
function onShowSettings() { tab.value = 'settings' }
function onArchiveUpdated() { void refreshContext() }
onBeforeUnmount(() => {
  alive = false
  ++contextRevision
  unsubscribeContext?.()
  unsubscribeSettings?.()
  window.removeEventListener('pointerdown', closeMenuOnOutsidePress, true)
  window.removeEventListener(OPEN_ARCHIVE_EVENT, onShowArchive)
  window.removeEventListener(OPEN_SETTINGS_EVENT, onShowSettings)
  window.removeEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCaptureRequest)
  window.removeEventListener(HISTORY_LOADER_STATE_EVENT, onLoaderState)
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, onArchiveUpdated)
  window.removeEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, onIncompatible)
})
</script>

<template>
  <section class="booster-chatgpt-panel" :lang="locale">
    <header class="booster-dock-context" aria-label="ChatGPT Booster">
      <div class="booster-dock-context-info">
        <CopyIdentity
          :label="current.conversationTitle || tr('Текущий диалог', 'Current conversation')"
          :identifier="current.conversationId"
          :locale="locale"
        />
        <CopyIdentity
          v-if="current.projectId"
          :label="current.projectTitle || tr('Проект', 'Project')"
          :identifier="current.projectId"
          :locale="locale"
        />
      </div>
      <p v-if="loading" role="status">{{ tr('Чтение состояния…', 'Reading status…') }}</p>
      <div v-if="coverage" class="booster-dock-counts">
        <span>{{ tr('Сообщений', 'Messages') }}: <b>{{ coverage.visibleMessageCount }}</b></span>
        <span>{{ tr('Деталей', 'Details') }}: {{ coverage.internalRecordCount }}</span>
      </div>
      <div v-if="current.conversationId" class="booster-dock-history-state">
        {{ coverage?.hasOlderServerHistory === true
          ? tr('Есть более ранняя история', 'Older server history available')
          : coverage?.hasOlderServerHistory === false
            ? tr('Начало истории достигнуто', 'Start of history reached')
            : tr('Полнота истории не проверена', 'History completeness unverified') }}
      </div>
      <button class="booster-capture-shortcut" type="button"
        :disabled="!context" @click="openCapture()">
        <ShieldCheck class="size-4" />{{ captureActive ? tr('Автосохранение включено', 'Capture enabled')
          : tr('Настроить автосохранение', 'Configure capture') }}
      </button>
    </header>
    <p v-if="error" class="booster-error" role="alert">{{ error }}</p>
    <div v-if="active" class="booster-dock-progress" role="status">
      <span>{{ tr('Загрузка истории', 'History collection') }}: {{ loader.phase }}
        · {{ tr('Сообщения', 'Messages') }} {{ loader.knownMessageCount }}
        · {{ tr('Страницы', 'Pages') }} {{ loader.pagesLoaded }}</span>
      <button class="booster-icon-button" type="button" :aria-label="tr('Остановить загрузку', 'Stop collection')" @click="stopCollection">
        <Square class="size-4" />
      </button>
    </div>
    <nav class="booster-export-recovery-actions" :aria-label="tr('Действия ChatGPT Booster', 'ChatGPT Booster actions')">
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='archive'" @click="showArchive()">
        <Archive class="size-4" />{{ tr('Архив', 'Archive') }}
      </button>
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='export'"
        :disabled="!current.conversationId" @click="currentExport">
        <Download class="size-4" />{{ tr('Экспорт', 'Export') }}
      </button>
      <button v-if="!context?.archiveAdapter.collectionInsideExportOnly" class="booster-action-secondary"
        type="button" :disabled="!current.conversationId || active" @click="collect">
        <ArrowUpToLine class="size-4" />{{ tr('Собрать историю', 'Collect history') }}
      </button>
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='capture'" @click="openCapture()">
        <ShieldCheck class="size-4" />{{ tr('Сохранение', 'Capture') }}
      </button>
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='settings'" @click="tab='settings'">
        <Settings2 class="size-4" />{{ tr('Настройки', 'Settings') }}
      </button>
      <button class="booster-action-secondary" type="button"
        :aria-label="tr('Экспорт старых баз', 'Export historical databases')"
        @click="archiveMenuOpen=false; maintenanceOpen=true">
        <Wrench class="size-4" />{{ tr('Старые базы', 'Historical backups') }}
      </button>
      <div ref="archiveMenuArea" class="booster-reader-tools" @keydown.esc.stop="archiveMenuOpen=false">
        <button class="booster-action-secondary" type="button"
          :aria-label="tr('Дополнительные действия с архивом', 'More archive actions')"
          :aria-expanded="archiveMenuOpen" aria-haspopup="menu" @click="archiveMenuOpen=!archiveMenuOpen">
          <Ellipsis class="size-4" />{{ tr('Ещё', 'More') }}
        </button>
        <div v-if="archiveMenuOpen" class="booster-reader-tools-menu" role="menu">
          <button type="button" role="menuitem" @click="archiveMenuOpen=false; maintenanceOpen=true">
            <Wrench class="size-4" />{{ tr('Экспорт v3/v4 без изменений', 'Export v3/v4 read-only') }}
          </button>
          <button type="button" role="menuitem" @click="openCapture()">
            <ShieldCheck class="size-4" />{{ tr('Правила сохранения', 'Capture rules') }}
          </button>
          <button type="button" role="menuitem" @click="archiveMenuOpen=false; showArchive()">
            <Archive class="size-4" />{{ tr('Открыть сохранённые диалоги', 'Open saved conversations') }}
          </button>
        </div>
      </div>
    </nav>
    <section v-if="context?.fixedArchive && current.conversationId && tab==='archive'"
      class="booster-stack-card" aria-label="Фиксированный Dexie архив ChatGPT">
      <div class="booster-setting-copy">
        <b>{{ tr('Dexie — собственная структура v1', 'Dexie — fixed canonical v1') }}</b>
        <small>{{ tr('Только новые подтверждённые события сохранения; прежние базы v3/v4 не переносятся.',
          'Only new verified capture events; existing v3/v4 archives are not converted.') }}</small>
        <small v-if="fixedCount !== null">{{ tr('Сохранено', 'Saved') }}: {{ fixedCount }}</small>
        <small v-if="context.fixedArchive.captureFailed()" role="status">Исходное сообщение изменилось; прежний снимок сохранён.</small>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="booster-action-secondary" :disabled="fixedBusy"
          @click="readFixedArchive">{{ tr('Читать Dexie', 'Read Dexie') }}</button>
        <button type="button" class="booster-action-secondary" :disabled="fixedBusy"
          @click="exportFixedArchive">{{ tr('Экспорт Dexie JSON.gz', 'Export Dexie JSON.gz') }}</button>
      </div>
      <p v-if="fixedError" role="alert">{{ fixedError }}</p>
      <ol v-if="fixedPreview.length" class="max-h-60 overflow-y-auto p-2">
        <li v-for="record in fixedPreview" :key="record.id" class="border-b border-border py-2">
          <b>{{ record.id }}</b>
          <span v-if="record.coverage==='contains_opaque'"> · {{ tr('Есть неизвестные части', 'Contains unknown content') }}</span>
          <p class="whitespace-pre-wrap break-words">{{ record.text }}</p>
        </li>
      </ol>
    </section>
    <div v-if="!context" role="status">{{ tr('Архив запускается…', 'Loading archive…') }}</div>
    <template v-else>
      <ArchiveBrowser
        v-if="tab==='archive'"
        :archive-adapter="context.archiveAdapter"
        :initial-conversation-id="archiveInitial"
        :navigation-target="navigationTarget"
        :locale="locale"
        :windowed="false"
        :can-return-to-export="returnToExport && !!selectedChat"
        @return-export="tab='export'"
        @export="(id, title) => openExport(id, title, true)"
        @close="closePanel"
      />
      <section v-else-if="tab==='export' && selectedChat" class="booster-stack-card"
        aria-label="Экспорт фиксированного Dexie-архива">
        <b>{{ selectedChat.title || selectedChat.id }}</b>
        <p>{{ tr('Экспорт из собственной схемы Dexie v1. Полнота истории не подтверждена.',
          'Export from fixed Dexie v1. History completeness is unverified.') }}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="booster-action-secondary" :disabled="fixedBusy"
            @click="exportSelectedDexie">{{ tr('Экспорт JSONL.gz', 'Export JSONL.gz') }}</button>
          <button type="button" class="booster-action-secondary" @click="showArchive()">
            {{ tr('К архиву', 'Back to archive') }}
          </button>
        </div>
        <p v-if="fixedError" role="alert">{{ fixedError }}</p>
      </section>
      <CaptureSettingsSurface
        v-else-if="tab==='capture'"
        :settings-adapter="context.settingsAdapter"
        :archive-adapter="context.archiveAdapter"
        :context="captureContext"
        :locale="locale"
        @close="endCapture"
      />
      <ControlCenter v-else-if="tab==='settings'"
        :settings-adapter="context.settingsAdapter"
        :archive-adapter="context.archiveAdapter"
        :diagnostics-adapter="context.diagnosticsAdapter"
        :persistent-diagnostics-adapter="context.persistentDiagnosticsAdapter"
        :secret-adapter="context.secretAdapter"
        :telemetry-control-adapter="context.telemetryControlAdapter"
        :target-label="context.targetLabel"
        :show-close="false" :embedded="true"
      />
    </template>
    <section v-if="maintenanceOpen && context?.fixedArchive" class="booster-stack-card"
      aria-label="Читающий экспорт прежних баз ChatGPT">
      <b>{{ tr('Исторические базы — только экспорт', 'Historical databases — export only') }}</b>
      <p>{{ tr('Нет переноса и удаления данных. Останови сбор в старом расширении перед резервной копией.',
        'No migration or deletion. Stop old extension capture before exporting.') }}</p>
      <label class="booster-field"><input v-model="legacyBackupConfirmed" type="checkbox"
        :disabled="legacyBackupBusy" />
        {{ tr('Понимаю, что копия может содержать переписки всех локальных владельцев.',
          'I understand this file may include all local owners.') }}
      </label>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="booster-action-secondary"
          :disabled="legacyBackupBusy || !legacyBackupConfirmed" @click="saveLegacyReadOnly('v3')">
          {{ tr('Скачать 0.8.92 / v3', 'Export 0.8.92 / v3') }}
        </button>
        <button type="button" class="booster-action-secondary"
          :disabled="legacyBackupBusy || !legacyBackupConfirmed" @click="saveLegacyReadOnly('v4')">
          {{ tr('Скачать прежнюю v4', 'Export historical v4') }}
        </button>
        <button type="button" class="booster-action-secondary"
          :disabled="legacyBackupBusy" @click="maintenanceOpen=false">
          {{ tr('Закрыть', 'Close') }}
        </button>
      </div>
      <p v-if="legacyBackupError" role="alert">{{ legacyBackupError }}</p>
    </section>
  </section>
</template>
