<script setup lang="ts">
import {
  ARCHIVE_SOURCE_INCOMPATIBLE_EVENT,
  ARCHIVE_UPDATED_EVENT,
  type ArchiveCaptureContext,
  type ArchiveCurrentContext,
  type ArchiveMessageLocation,
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
  type HistoryLoaderState,
  OPEN_ARCHIVE_EVENT,
  OPEN_CAPTURE_SETTINGS_EVENT,
  OPEN_SETTINGS_EVENT,
  resolveCaptureRule,
} from '@chatgpt-booster/core'
import {
  type ChatCollectionController,
  type ChatCollectionSnapshot,
  createChatCollectionController,
} from '@kobaproduction/browser-archive'
import { SHELL_CLOSE_EVENT, shellInstanceKey } from '@kobaproduction/browser-core'
import { Button, useApplicationLocale } from '@kobaproduction/browser-ui'
import { ConversationCollectionAction } from '@kobaproduction/browser-widgets'
import { ShieldCheck } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveBrowser from '../../../../packages/ui/src/ArchiveBrowser.vue'
import ArchiveExportDialog from '../../../../packages/ui/src/ArchiveExportDialog.vue'
import CaptureSettingsSurface from '../../../../packages/ui/src/CaptureSettingsSurface.vue'
import ControlCenter from '../../../../packages/ui/src/ControlCenterPanel.vue'
import { translate } from '../../../../packages/ui/src/i18n'
import { installBoosterShadowStyles } from '../../../../packages/ui/src/shadow-styles'
import {
  chatGptArchiveRequest,
  chatGptRequestedSection,
  chatGptSafeView,
  chatGptViewContext,
  chatGptViewRevision,
  setChatGptSafeView,
} from '../../../index'
import { chatGptCollectionPort } from './chat-collection-port'

type View = 'archive' | 'export' | 'capture' | 'settings'
const props = withDefaults(defineProps<{ showCatalog?: boolean; showIdentity?: boolean }>(), {
  showCatalog: true,
  showIdentity: true,
})
const tab = ref<View>(chatGptSafeView.value)
const context = computed(() => chatGptViewContext.value)
const locale = useApplicationLocale(() => currentSettings.value?.language ?? 'auto')
const current = ref<ArchiveCurrentContext>({
  conversationId: null,
  conversationTitle: null,
  projectId: null,
  projectTitle: null,
})
const loader = ref<HistoryLoaderState>({
  phase: 'idle',
  conversationId: null,
  knownMessageCount: 0,
  hasOlderServerHistory: null,
  pagesLoaded: 0,
  consecutiveErrors: 0,
})
const loading = ref(false)
const collectionState = ref<ChatCollectionSnapshot>({
  phase: 'idle',
  processed: 0,
  total: null,
  saved: null,
})
let collector: ChatCollectionController | undefined
let unsubscribeCollection: (() => void) | undefined
watch(
  () => context.value?.archiveAdapter,
  (adapter) => {
    unsubscribeCollection?.()
    collector?.dispose()
    collector = adapter ? createChatCollectionController(chatGptCollectionPort(adapter)) : undefined
    collectionState.value = collector?.snapshot() ?? {
      phase: 'idle',
      processed: 0,
      total: null,
      saved: null,
    }
    unsubscribeCollection = collector?.subscribe((value) => {
      collectionState.value = value
    })
  },
  { immediate: true },
)
const error = ref('')
const selectedChat = ref<{ id: string; title: string | null; messageIds?: readonly string[] }>()
const captureContext = ref<ArchiveCaptureContext>()
const exportCapture = ref(false)
const archiveInitial = ref<string | null>(null)
const archiveProjectInitial = ref<string | null>(null)
const navigationTarget = ref<ArchiveMessageLocation | null>(null)
const returnToExport = ref(false)
const currentSettings =
  ref<Awaited<ReturnType<NonNullable<typeof context.value>['settingsAdapter']['get']>>>()
let alive = true
let contextRevision = 0
let activeOwner: string | null = null
let unsubscribeContext: (() => void) | undefined
let unsubscribeSettings: (() => void) | undefined

const active = computed(
  () =>
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
const captureActive = computed(
  () => !!currentSettings.value?.enabled && !!captureResolution.value?.rule.enabled,
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
const tr = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
function collectionErrorMessage(code?: string) {
  if (code === 'archive.error.freshReadRequired' || code === 'archive.error.incompleteSource')
    return translate(locale.value, code)
  return tr(
    'Сбор истории не выполнен. Исходные данные сохранены.',
    'History collection failed. Existing data was preserved.',
  )
}

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
    captureContext.value = undefined
  }
  loading.value = true
  try {
    const info = await adapter.getCurrentContext()
    if (
      !alive ||
      revision !== contextRevision ||
      adapter !== context.value?.archiveAdapter ||
      adapter.currentConversationId() !== conversationId ||
      (adapter.currentAccountId?.() ?? null) !== accountId
    )
      return
    current.value = info
    error.value =
      conversationId && adapter.hasIncompatibleSource?.(conversationId)
        ? tr(
            'Неподдерживаемый источник диалога: сохранённые данные не изменены.',
            'Unsupported conversation source: saved data was not changed.',
          )
        : ''
  } catch {
    if (alive && revision === contextRevision && accountId && conversationId)
      error.value = tr(
        'Не удалось прочитать текущий диалог. Сохранённый архив не сбрасывался.',
        'Unable to inspect the current conversation. The archive was not reset.',
      )
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
    unsubscribeSettings = adapters.settingsAdapter.subscribe((next) => {
      currentSettings.value = next
    })
    loader.value = adapters.archiveAdapter.getCollectionState?.() ?? loader.value
    unsubscribeContext = adapters.archiveAdapter.subscribeContextChange?.(() => {
      void refreshContext()
    })
    await refreshContext()
  } catch {
    error.value = tr(
      'Настройки недоступны. Архив не изменён.',
      'Settings unavailable. Archive untouched.',
    )
  }
}
function showArchive(
  id?: string | null,
  location?: ArchiveMessageLocation,
  scope?: ArchiveCaptureContext | null,
) {
  archiveProjectInitial.value = scope?.scope === 'project' ? scope.id : null
  archiveInitial.value =
    scope?.scope === 'conversation'
      ? scope.id
      : scope?.scope === 'project'
        ? current.value.projectId === scope.id
          ? current.value.conversationId
          : null
        : (id ??
          context.value?.archiveAdapter.currentConversationId() ??
          current.value.conversationId ??
          null)
  navigationTarget.value = location ?? null
  tab.value = 'archive'
}
async function currentExport() {
  const adapter = context.value?.archiveAdapter
  if (!adapter) return
  const revision = chatGptViewRevision.value
  const owner = adapter.currentAccountId?.() ?? null
  try {
    const next = await adapter.getCurrentContext()
    if (
      !alive ||
      revision !== chatGptViewRevision.value ||
      adapter !== context.value?.archiveAdapter ||
      owner !== (adapter.currentAccountId?.() ?? null)
    )
      return
    if (!next.conversationId) {
      error.value = tr('Сначала открой диалог для экспорта.', 'Open a conversation before exporting.')
      return
    }
    openExport(next.conversationId, next.conversationTitle)
  } catch {
    if (!alive || revision !== chatGptViewRevision.value) return
    error.value = tr('Не удалось получить текущий диалог.', 'Cannot resolve the current conversation.')
  }
}
function openExport(
  id: string,
  title: string | null,
  fromArchive = false,
  messageIds?: readonly string[],
) {
  selectedChat.value = { id, title, ...(messageIds ? { messageIds } : {}) }
  returnToExport.value = fromArchive
  archiveInitial.value = id
  error.value = ''
  tab.value = 'export'
}
function openCapture(scope?: ArchiveCaptureContext, fromExport = false) {
  captureContext.value = scope ?? captureTarget.value
  exportCapture.value = fromExport
  tab.value = 'capture'
}
function endCapture() {
  tab.value = exportCapture.value && selectedChat.value ? 'export' : 'archive'
  exportCapture.value = false
}
async function collect() {
  const adapter = context.value?.archiveAdapter
  if (!adapter || adapter.collectionInsideExportOnly || !adapter.currentConversationId()) return
  error.value = ''
  try {
    if (!collector) return
    await collector.start()
    await refreshContext()
  } catch (cause) {
    error.value = collectionErrorMessage(cause instanceof Error ? cause.message : undefined)
  }
}
function stopCollection() {
  if (collector) {
    collector.stop()
    return
  }
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
  if (
    !next ||
    ![
      'idle',
      'preparing',
      'scrolling',
      'waiting_for_load',
      'backoff',
      'saving',
      'complete',
      'cancelled',
      'error',
    ].includes(next.phase)
  )
    return
  loader.value = { ...next }
  if (next.phase === 'error' && next.conversationId === current.value.conversationId)
    error.value = collectionErrorMessage(next.message)
  if (next.phase === 'complete' && next.conversationId === current.value.conversationId)
    void refreshContext()
}
function onIncompatible(event: Event) {
  const id = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId
  if (id && id === current.value.conversationId)
    error.value = tr(
      'Исходные данные не изменены: ChatGPT использует другую схему.',
      'Source data not modified: ChatGPT uses an incompatible schema.',
    )
}
function onCaptureRequest(event: Event) {
  const detail = (event as CustomEvent<ArchiveCaptureContext>).detail
  openCapture(
    detail && (detail.scope === 'project' || detail.scope === 'conversation') ? detail : undefined,
  )
}
function closePanel() {
  window.dispatchEvent(new Event(SHELL_CLOSE_EVENT))
}

watch(
  context,
  () => {
    void initializeContext()
  },
  { immediate: true },
)
watch(
  chatGptSafeView,
  (view) => {
    if (tab.value === view) return
    if (view === 'archive') showArchive()
    else if (view === 'capture') openCapture()
    else tab.value = 'settings'
  },
  { flush: 'sync' },
)
watch(
  tab,
  (view) => {
    // Export is a transient workflow with separately selected data, never a
    // persisted command. Returning to a safe view does not replay an operation.
    if (view !== 'export' && chatGptSafeView.value !== view) setChatGptSafeView(view)
  },
  { flush: 'sync' },
)
watch(
  chatGptRequestedSection,
  (section) => {
    if (!section) return
    // Consume before invoking anything asynchronous or changing a mounted branch.
    chatGptRequestedSection.value = null
    if (section === 'archive') {
      const scope = chatGptArchiveRequest.value
      chatGptArchiveRequest.value = null
      showArchive(undefined, undefined, scope)
    }
    if (section === 'settings') tab.value = 'settings'
    if (section === 'capture') openCapture()
    if (section === 'collect') void collect()
    if (section === 'export') void currentExport()
  },
  { immediate: true },
)
onMounted(() => {
  const root = document.getElementById(shellInstanceKey('koba-browser-tools-root'))?.shadowRoot
  if (root) installBoosterShadowStyles(root)
  window.addEventListener(OPEN_ARCHIVE_EVENT, onShowArchive)
  window.addEventListener(OPEN_SETTINGS_EVENT, onShowSettings)
  window.addEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCaptureRequest)
  window.addEventListener(HISTORY_LOADER_STATE_EVENT, onLoaderState)
  window.addEventListener(ARCHIVE_UPDATED_EVENT, onArchiveUpdated)
  window.addEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, onIncompatible)
  window.dispatchEvent(new Event('chatgpt-booster:history-loader-query'))
})
function onShowArchive(event: Event) {
  showArchive(undefined, undefined, (event as CustomEvent<ArchiveCaptureContext | undefined>).detail)
}
function onShowSettings() {
  tab.value = 'settings'
}
function onArchiveUpdated() {
  void refreshContext()
}
onBeforeUnmount(() => {
  unsubscribeCollection?.()
  collector?.dispose()
  alive = false
  ++contextRevision
  unsubscribeContext?.()
  unsubscribeSettings?.()
  window.removeEventListener(OPEN_ARCHIVE_EVENT, onShowArchive)
  window.removeEventListener(OPEN_SETTINGS_EVENT, onShowSettings)
  window.removeEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onCaptureRequest)
  window.removeEventListener(HISTORY_LOADER_STATE_EVENT, onLoaderState)
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, onArchiveUpdated)
  window.removeEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, onIncompatible)
})
</script>

<template>
  <section class="booster-chatgpt-panel" :lang="locale" :data-provider-view="tab">
    <p v-if="error && tab !== 'settings'" class="booster-error" role="alert">{{ error }}</p>
    <div v-if="active && tab === 'archive'" class="booster-dock-progress" role="status">
      <span>{{ tr('Загрузка истории', 'History collection') }}: {{ loader.phase }}
        · {{ tr('Сообщения', 'Messages') }} {{ loader.knownMessageCount }}
        · {{ tr('Страницы', 'Pages') }} {{ loader.pagesLoaded }}</span>
    </div>
    <div v-if="!context" role="status">{{ tr('Архив запускается…', 'Loading archive…') }}</div>
    <template v-else>
      <ArchiveBrowser
        :key="archiveProjectInitial ?? 'all-projects'"
        v-if="tab==='archive'"
        :archive-adapter="context.archiveAdapter"
        :initial-conversation-id="archiveInitial"
        :initial-project-id="archiveProjectInitial"
        :navigation-target="navigationTarget"
        :locale="locale"
        :windowed="false"
        :can-return-to-export="returnToExport && !!selectedChat"
        @return-export="tab='export'"
        @export="(id, title, ids) => openExport(id, title, true, ids)"
        @close="closePanel"
      >    <template #collection-actions>
      <Button variant="ghost" size="sm" type="button"
        :title="captureActive ? tr('Автосохранение включено', 'Capture enabled') : tr('Настроить автосохранение', 'Configure capture')"
        @click="openCapture()"><ShieldCheck class="size-4" />{{ tr('Настройки автосохранения', 'Auto-save settings') }}</Button>
      <ConversationCollectionAction
        variant="ghost"
        :data-active="active" :label="tr('Собрать историю', 'Collect history')" :busy="active"
        :saved-label="tr('Сохранено', 'Saved')" :stop-label="tr('Остановить', 'Stop')"
        :disabled="loading || !current.conversationId || !!context.archiveAdapter.collectionInsideExportOnly"
        :processed="collectionState.processed" :total="collectionState.total"
        @start="collect" @stop="stopCollection" />
    </template>
      </ArchiveBrowser>
      <ArchiveExportDialog v-else-if="tab==='export' && selectedChat"
        :archive-adapter="context.archiveAdapter" :settings-adapter="context.settingsAdapter"
        :conversation-id="selectedChat.id" :title="selectedChat.title" :locale="locale"
        :selected-message-ids="selectedChat.messageIds"
        @close="showArchive(selectedChat.id)" @open-archive="showArchive"
        @open-capture="value => { captureContext = value; tab = 'capture' }" />
      <CaptureSettingsSurface
        v-else-if="tab==='capture'"
        :settings-adapter="context.settingsAdapter"
        :archive-adapter="context.archiveAdapter"
        :context="captureContext"
        :locale="locale"
        @close="endCapture"
      />
      <ControlCenter v-else-if="tab==='settings'"
        :embedded="!props.showIdentity"
        :show-catalog="props.showCatalog"
        :settings-adapter="context.settingsAdapter"
        :archive-adapter="context.archiveAdapter"
        :diagnostics-adapter="context.diagnosticsAdapter"
        :persistent-diagnostics-adapter="context.persistentDiagnosticsAdapter"
        :secret-adapter="context.secretAdapter"
        :automation-control="context.automationControl"
        :telemetry-control-adapter="context.telemetryControlAdapter"
        :target-label="context.targetLabel"
        :show-close="false"
      />
    </template>
  </section>
</template>
