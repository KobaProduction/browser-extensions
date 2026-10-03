<script setup lang="ts">
import {
  OPEN_SETTINGS_EVENT,
  type BoosterSettings,
  type DiagnosticsAdapter,
  type PersistentDiagnosticsAdapter,
  type SecretAdapter,
  type SettingsAdapter,
  type TelemetryControlAdapter,
  snapshotSettings,
} from '@chatgpt-booster/core'
import { Database, GripVertical, Layers3, RefreshCw, Settings, Square } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ArchiveBrowser from './ArchiveBrowser.vue'
import ControlCenterPanel from './ControlCenterPanel.vue'
import { resolveLocale, translate } from './i18n'
import type {
  ArchiveConversationView,
  ArchiveCoverageView,
  ArchiveDataAdapter,
} from './mount'

const props = defineProps<{
  settingsAdapter: SettingsAdapter
  diagnosticsAdapter?: DiagnosticsAdapter | undefined
  persistentDiagnosticsAdapter?: PersistentDiagnosticsAdapter | undefined
  secretAdapter?: SecretAdapter | undefined
  telemetryControlAdapter?: TelemetryControlAdapter | undefined
  archiveAdapter?: ArchiveDataAdapter | undefined
  target: 'extension' | 'userscript'
}>()

interface HistoryLoaderState {
  phase: string
  conversationId: string | null
  knownMessageCount: number
  hasOlderServerHistory: boolean | null
  pagesLoaded: number
  consecutiveErrors: number
  message?: string
}

const BUTTON_SIZE = 48
const VIEWPORT_MARGIN = 12
const DRAG_THRESHOLD = 4
const HISTORY_LOADER_START_EVENT = 'chatgpt-booster:history-loader-start'
const HISTORY_LOADER_STOP_EVENT = 'chatgpt-booster:history-loader-stop'
const HISTORY_LOADER_STATE_EVENT = 'chatgpt-booster:history-loader-state'
const ARCHIVE_UPDATED_EVENT = 'chatgpt-booster:archive-updated'

const quickOpen = ref(false)
const settingsOpen = ref(false)
const archiveOpen = ref(false)
const settings = ref<BoosterSettings>()
const position = ref({ x: 0, y: 0 })
const dragging = ref(false)
const currentConversation = ref<ArchiveConversationView>()
const coverage = ref<ArchiveCoverageView>()
const contextLoading = ref(false)
const loaderState = ref<HistoryLoaderState>({
  phase: 'idle',
  conversationId: null,
  knownMessageCount: 0,
  hasOlderServerHistory: null,
  pagesLoaded: 0,
  consecutiveErrors: 0,
})

let unsubscribe: (() => void) | undefined
let dragStart:
  | {
      pointerId: number
      clientX: number
      clientY: number
      x: number
      y: number
      moved: boolean
    }
  | undefined

const locale = computed(() => resolveLocale(settings.value?.language ?? 'auto'))
const t = (key: Parameters<typeof translate>[1]) => translate(locale.value, key)

const launcherStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))

const quickStyle = computed(() => {
  const width = 330
  const estimatedHeight = 300
  return {
    left: `${Math.min(Math.max(VIEWPORT_MARGIN, position.value.x - width + BUTTON_SIZE), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN))}px`,
    top: `${Math.max(VIEWPORT_MARGIN, position.value.y - estimatedHeight - 10)}px`,
  }
})

const loaderActive = computed(() =>
  ['preparing', 'scrolling', 'waiting_for_load', 'backoff'].includes(loaderState.value.phase),
)

const currentConversationId = computed(() => {
  try {
    return new URL(location.href).pathname.match(/(?:^|\/)c\/([^/?#]+)/)?.[1] ?? null
  } catch {
    return null
  }
})

const coverageLabel = computed(() => {
  if (!currentConversationId.value) return t('quick.noConversation')
  if (!coverage.value) return t('quick.notArchived')
  if (coverage.value.completeAtLastRead || coverage.value.hasOlderServerHistory === false) {
    return t('quick.complete')
  }
  return t('quick.partial')
})

function defaultPosition() {
  return {
    x: Math.max(VIEWPORT_MARGIN, window.innerWidth - BUTTON_SIZE - 20),
    y: Math.max(VIEWPORT_MARGIN, window.innerHeight - BUTTON_SIZE - 20),
  }
}

function clampPosition(x: number, y: number) {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - BUTTON_SIZE - VIEWPORT_MARGIN)
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - BUTTON_SIZE - VIEWPORT_MARGIN)
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, x), maxX),
    y: Math.min(Math.max(VIEWPORT_MARGIN, y), maxY),
  }
}

function applyStoredPosition(next: BoosterSettings) {
  const stored = next.launcher
  position.value =
    stored.x === null || stored.y === null
      ? defaultPosition()
      : clampPosition(stored.x, stored.y)
}

async function savePosition() {
  if (!settings.value) return
  const persisted = await props.settingsAdapter.update({
    launcher: { x: Math.round(position.value.x), y: Math.round(position.value.y) },
  })
  settings.value = persisted
}

async function refreshContext() {
  const id = currentConversationId.value
  currentConversation.value = undefined
  coverage.value = undefined
  if (!id || !props.archiveAdapter) return
  contextLoading.value = true
  try {
    const [conversation, nextCoverage] = await Promise.all([
      props.archiveAdapter.getConversation(id),
      props.archiveAdapter.getCoverage(id),
    ])
    currentConversation.value = conversation
    coverage.value = nextCoverage
  } finally {
    contextLoading.value = false
  }
}

function startHistoryLoad(force: boolean) {
  window.dispatchEvent(new CustomEvent(HISTORY_LOADER_START_EVENT, { detail: { force } }))
}

function stopHistoryLoad() {
  window.dispatchEvent(new Event(HISTORY_LOADER_STOP_EVENT))
}

function openSettings() {
  quickOpen.value = false
  archiveOpen.value = false
  settingsOpen.value = true
}

function openArchive() {
  quickOpen.value = false
  settingsOpen.value = false
  archiveOpen.value = true
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  dragStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: position.value.x,
    y: position.value.y,
    moved: false,
  }
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return
  const dx = event.clientX - dragStart.clientX
  const dy = event.clientY - dragStart.clientY
  if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) dragStart.moved = true
  position.value = clampPosition(dragStart.x + dx, dragStart.y + dy)
}

async function onPointerUp(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return
  const moved = dragStart.moved
  dragStart = undefined
  dragging.value = false
  if (moved) {
    await savePosition()
    return
  }
  quickOpen.value = !quickOpen.value
  settingsOpen.value = false
  archiveOpen.value = false
  if (quickOpen.value) void refreshContext()
}

function onResize() {
  const next = clampPosition(position.value.x, position.value.y)
  if (next.x === position.value.x && next.y === position.value.y) return
  position.value = next
  void savePosition()
}

function onOpenSettings() {
  openSettings()
}

function onLoaderState(event: Event) {
  const detail = (event as CustomEvent<HistoryLoaderState>).detail
  if (!detail) return
  loaderState.value = detail
  void refreshContext()
}

function onArchiveUpdated() {
  if (quickOpen.value) void refreshContext()
}

onMounted(async () => {
  settings.value = await props.settingsAdapter.get()
  applyStoredPosition(settings.value)

  unsubscribe = props.settingsAdapter.subscribe((next) => {
    settings.value = snapshotSettings(next)
    if (!dragging.value) applyStoredPosition(next)
  })

  window.addEventListener('resize', onResize)
  window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
  window.addEventListener(HISTORY_LOADER_STATE_EVENT, onLoaderState)
  window.addEventListener(ARCHIVE_UPDATED_EVENT, onArchiveUpdated)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  window.removeEventListener('resize', onResize)
  window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
  window.removeEventListener(HISTORY_LOADER_STATE_EVENT, onLoaderState)
  window.removeEventListener(ARCHIVE_UPDATED_EVENT, onArchiveUpdated)
})
</script>

<template>
  <div class="booster-overlay-root">
    <div v-if="settingsOpen" class="booster-modal-backdrop" @click.self="settingsOpen = false">
      <div class="booster-modal-surface">
        <ControlCenterPanel
          :settings-adapter="settingsAdapter"
          :diagnostics-adapter="diagnosticsAdapter"
          :persistent-diagnostics-adapter="persistentDiagnosticsAdapter"
          :secret-adapter="secretAdapter"
          :telemetry-control-adapter="telemetryControlAdapter"
          :target="target"
          show-close
          @close="settingsOpen = false"
        />
      </div>
    </div>

    <div v-if="archiveOpen && archiveAdapter" class="booster-modal-backdrop booster-archive-backdrop">
      <div class="booster-archive-surface">
        <ArchiveBrowser
          :archive-adapter="archiveAdapter"
          :initial-conversation-id="currentConversationId"
          :locale="locale"
          @close="archiveOpen = false"
        />
      </div>
    </div>

    <section v-if="quickOpen" class="booster-quick-menu" :style="quickStyle">
      <header class="booster-quick-header">
        <div>
          <strong>{{ t('quick.title') }}</strong>
          <span>{{ coverageLabel }}</span>
        </div>
        <button type="button" class="booster-icon-button" :title="t('quick.settings')" @click="openSettings">
          <Settings class="size-4" />
        </button>
      </header>

      <div v-if="currentConversationId" class="booster-quick-context">
        <strong>{{ currentConversation?.title || t('quick.currentConversation') }}</strong>
        <code>{{ currentConversationId }}</code>
        <div class="booster-quick-chips">
          <span v-if="currentConversation?.projectId">{{ t('quick.project') }} {{ currentConversation.projectId }}</span>
          <span>{{ t('quick.messages') }} {{ coverage?.knownMessageCount ?? loaderState.knownMessageCount ?? 0 }}</span>
          <span v-if="currentConversation?.branchSourceConversationId">{{ t('quick.branch') }}</span>
        </div>
      </div>
      <div v-else class="booster-quick-empty">{{ t('quick.noConversationDescription') }}</div>

      <div v-if="loaderActive" class="booster-loader-status">
        <RefreshCw class="size-4 booster-spin" />
        <div>
          <strong>{{ t('quick.loadingHistory') }}</strong>
          <span>{{ loaderState.phase }} · +{{ loaderState.pagesLoaded }} {{ t('quick.pages') }}</span>
        </div>
        <button type="button" class="booster-icon-button" :title="t('quick.stop')" @click="stopHistoryLoad">
          <Square class="size-3" />
        </button>
      </div>
      <div v-else-if="loaderState.phase === 'error'" class="booster-loader-error">
        {{ loaderState.message || t('quick.loaderError') }}
      </div>

      <div class="booster-quick-actions">
        <button
          type="button"
          class="booster-quick-primary"
          :disabled="!currentConversationId || loaderActive"
          @click="startHistoryLoad(Boolean(coverage?.completeAtLastRead))"
        >
          <RefreshCw class="size-4" />
          {{ coverage?.completeAtLastRead ? t('quick.reread') : t('quick.readToTop') }}
        </button>
        <button type="button" class="booster-quick-secondary" :disabled="!archiveAdapter" @click="openArchive">
          <Database class="size-4" />
          {{ t('quick.openArchive') }}
        </button>
      </div>
    </section>

    <button
      class="booster-launcher"
      :class="{ 'booster-launcher-dragging': dragging, 'booster-launcher-open': quickOpen }"
      :style="launcherStyle"
      type="button"
      :title="t('launcher.title')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart = undefined; dragging = false"
    >
      <GripVertical class="booster-launcher-grip" />
      <Layers3 class="booster-launcher-icon" />
    </button>
  </div>
</template>
