<script setup lang="ts">
import {
  ARCHIVE_UPDATED_EVENT, dockFromDrop, dockPosition,
  HISTORY_LOADER_STATE_EVENT, HISTORY_LOADER_STOP_EVENT, normalizeSettings,
  OPEN_ARCHIVE_EVENT, OPEN_CAPTURE_SETTINGS_EVENT, OPEN_SETTINGS_EVENT, resolveCaptureRule,
  snapshotSettings, type ArchiveCaptureContext, type ArchiveCurrentContext, type HistoryLoaderState,
} from '@chatgpt-booster/core'
import Archive from 'lucide-vue-next/dist/esm/icons/archive.js'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import Layers3 from 'lucide-vue-next/dist/esm/icons/layers.js'
import Settings from 'lucide-vue-next/dist/esm/icons/settings.js'
import ShieldCheck from 'lucide-vue-next/dist/esm/icons/shield-check.js'
import Square from 'lucide-vue-next/dist/esm/icons/square.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import ArrowUpToLine from 'lucide-vue-next/dist/esm/icons/arrow-up-to-line.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ArchiveWorkspace from './ArchiveWorkspace.vue'
import ArchiveExportDialog from './ArchiveExportDialog.vue'
import ControlCenterPanel from './ControlCenterPanel.vue'
import CaptureSettingsSurface from './CaptureSettingsSurface.vue'
import CopyIdentity from './CopyIdentity.vue'
import ModalSurface from './ModalSurface.vue'
import { resolveLocale, translate, type TranslationKey } from './i18n'
import type { ArchiveCoverageView, BoosterUiOptions } from './mount'
const props = defineProps<BoosterUiOptions>()
const SIZE = 44
const settings = ref(normalizeSettings())
const expanded = ref(false), dragging = ref(false), loading = ref(false), savedChat = ref(false), archiveOpen = ref(false)
const view = ref<'settings' | 'capture' | 'export' | null>(null)
const context = ref<ArchiveCurrentContext>({ conversationId: null, conversationTitle: null, projectId: null, projectTitle: null })
const coverage = ref<ArchiveCoverageView>()
const captureContext = ref<ArchiveCaptureContext>()
const archiveInitial = ref<string | null>(null)
const exportTarget = ref<{ id: string; title: string | null; backToArchive: boolean }>()
const error = ref<TranslationKey | null>(null)
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const dragPosition = ref<{ x: number; y: number }>()
const loader = ref<HistoryLoaderState>({ phase: 'idle', conversationId: null, knownMessageCount: 0, hasOlderServerHistory: null, pagesLoaded: 0, consecutiveErrors: 0 })
const toggleButton = ref<HTMLButtonElement>()
let unsubscribe: (() => void) | undefined, contextUnsubscribe: (() => void) | undefined
let contextFallbackTimer: ReturnType<typeof setInterval> | undefined
let archiveRefreshTimer: ReturnType<typeof setTimeout> | undefined
let alive = true, revision = 0, ignoreClick = false, refreshAt = 0
let pointer: { id: number; startX: number; startY: number; x: number; y: number; moved: boolean } | undefined
const locale = computed(() => resolveLocale(settings.value.language))
const t = (key: TranslationKey) => translate(locale.value, key)
const position = computed(() => dragPosition.value ?? dockPosition(settings.value.launcher.side, settings.value.launcher.heightRatio, viewport.value.width, viewport.value.height, SIZE))
const side = computed(() => settings.value.launcher.side)
const growsUp = computed(() => position.value.y > (viewport.value.height - SIZE) / 2)
const shellMaxHeight = computed(() => Math.max(SIZE, (growsUp.value ? position.value.y + SIZE : viewport.value.height - position.value.y) - 8))
const opened = computed(() => expanded.value || view.value !== null)
const active = computed(() => ['preparing', 'scrolling', 'waiting_for_load', 'backoff'].includes(loader.value.phase) && loader.value.conversationId === context.value.conversationId)
const cachedMessageCount = computed(() =>
  Math.max(coverage.value?.visibleMessageCount ?? 0, loader.value.knownMessageCount ?? 0),
)
const cachedDetailCount = computed(() => coverage.value?.internalRecordCount ?? 0)
const captureResolution = computed(() =>
  context.value.conversationId
    ? resolveCaptureRule(
        settings.value.archive,
        context.value.conversationId,
        context.value.projectId,
      )
    : null,
)
const autoCapture = computed(
  () => !!captureResolution.value && settings.value.enabled && captureResolution.value.rule.enabled,
)
const captureStatusKey = computed<TranslationKey>(() => {
  if (!settings.value.enabled) return 'dock.autoMasterOff'
  if (
    context.value.conversationId &&
    settings.value.archive.conversations[context.value.conversationId]
  )
    return autoCapture.value ? 'dock.autoChatOn' : 'dock.autoChatOff'
  if (context.value.projectId)
    return autoCapture.value ? 'dock.autoProjectOn' : 'dock.autoProjectOff'
  return autoCapture.value ? 'dock.autoDefaultOn' : 'dock.autoDefaultOff'
})
const currentCaptureTarget = computed<ArchiveCaptureContext | undefined>(() => {
  if (!context.value.conversationId) return undefined
  if (captureResolution.value?.source !== 'conversation' && context.value.projectId)
    return {
      scope: 'project',
      id: context.value.projectId,
      title: context.value.projectTitle,
    }
  return {
    scope: 'conversation',
    id: context.value.conversationId,
    title: context.value.conversationTitle,
    projectId: context.value.projectId,
  }
})
const safeError = (value: unknown): TranslationKey => {
  const message = value instanceof Error ? value.message : ''
  return ['archive.error.noChat', 'archive.error.draft', 'archive.error.attachments', 'archive.error.generating', 'archive.error.storage', 'archive.error.timeout', 'archive.error.noProgress', 'archive.error.auth', 'archive.error.network'].includes(message) ? message as TranslationKey : 'archive.error.unknown'
}
async function refreshContext() {
  const adapter = props.archiveAdapter
  if (!adapter) return
  const currentId = adapter.currentConversationId()
  const request = ++revision
  if (context.value.conversationId !== currentId) {
    context.value = { conversationId: currentId, conversationTitle: null, projectId: adapter.currentProjectId(), projectTitle: null }
    coverage.value = undefined; savedChat.value = false; error.value = null
  }
  loading.value = !coverage.value
  refreshAt = Date.now()
  try {
    const [next, nextCoverage, stored] = await Promise.all([adapter.getCurrentContext(), currentId ? adapter.getCoverage(currentId) : undefined, currentId ? adapter.getConversation(currentId) : undefined])
    if (!alive || request !== revision || adapter.currentConversationId() !== currentId) return
    context.value = next; coverage.value = nextCoverage; savedChat.value = !!stored
  } catch { if (alive && request === revision) error.value = 'archive.error.storage' }
  finally { if (alive && request === revision) loading.value = false }
}
function closeView() { view.value = null }
function toggle() {
  if (ignoreClick) { ignoreClick = false; return }
  if (view.value) { view.value = null; expanded.value = false; return }
  expanded.value = !expanded.value
  if (expanded.value) void refreshContext()
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  ignoreClick = false
  pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, ...position.value, moved: false }
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* Synthetic test events do not own a pointer. */ }
}
function pointerMove(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.id) return
  const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY
  if (Math.hypot(dx, dy) < 6 && !pointer.moved) return
  pointer.moved = true; dragging.value = true
  dragPosition.value = { x: Math.max(0, Math.min(viewport.value.width - SIZE, pointer.x + dx)), y: Math.max(0, Math.min(viewport.value.height - SIZE, pointer.y + dy)) }
}
async function pointerUp(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.id) return
  const moved = pointer.moved
  pointer = undefined; dragging.value = false
  if (!moved) return
  const point = dragPosition.value ?? position.value
  const dock = dockFromDrop(point.x, point.y, viewport.value.width, viewport.value.height, SIZE)
  ignoreClick = true; dragPosition.value = undefined
  settings.value.launcher = { ...settings.value.launcher, ...dock, x: null, y: null }
  try { settings.value = snapshotSettings(await props.settingsAdapter.update({ launcher: { ...dock, x: null, y: null } })) }
  catch { error.value = 'common.saveError' }
}
function cancelPointer() { pointer = undefined; dragging.value = false; dragPosition.value = undefined }
function resize() { viewport.value = { width: window.innerWidth, height: window.innerHeight }; cancelPointer() }
function openArchive(id = context.value.conversationId) { archiveInitial.value = id; archiveOpen.value = true; expanded.value = false }
function openExport(id: string, title: string | null, fromArchive = false) { exportTarget.value = { id, title, backToArchive: fromArchive }; archiveInitial.value = id; expanded.value = false; view.value = 'export' }
function openSettings() { captureContext.value = undefined; expanded.value = false; view.value = 'settings' }
function openCapture(scope?: ArchiveCaptureContext) {
  captureContext.value = scope
  expanded.value = false
  view.value = 'capture'
}
async function collect() {
  error.value = null
  try {
    await props.archiveAdapter?.collectCurrent()
    expanded.value = true
  } catch (cause) {
    error.value = safeError(cause)
  }
}
function stop() { window.dispatchEvent(new Event(HISTORY_LOADER_STOP_EVENT)) }
function onState(event: Event) {
  const next = (event as CustomEvent<HistoryLoaderState>).detail
  if (!next || !['idle', 'preparing', 'scrolling', 'waiting_for_load', 'backoff', 'complete', 'cancelled', 'error'].includes(next.phase)) return
  const changed = next.pagesLoaded !== loader.value.pagesLoaded || next.phase === 'complete'
  loader.value = { ...next }
  if (next.conversationId === props.archiveAdapter?.currentConversationId() && next.phase === 'preparing') {
    expanded.value = true
    void refreshContext()
  } else if (changed && opened.value && Date.now() - refreshAt > 700) void refreshContext()
}
function onArchive() {
  if (!opened.value && !archiveOpen.value) return
  clearTimeout(archiveRefreshTimer)
  const wait = Math.max(0, 180 - (Date.now() - refreshAt))
  archiveRefreshTimer = setTimeout(() => {
    archiveRefreshTimer = undefined
    void refreshContext()
  }, wait)
}
function onOpenArchive(event: Event) { const id = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId; openArchive(id ?? context.value.conversationId) }
function onOpenCapture(event: Event) {
  const scope = (event as CustomEvent<ArchiveCaptureContext>).detail
  if (scope && (scope.scope === 'project' || scope.scope === 'conversation') && typeof scope.id === 'string') void openCapture(scope)
}
function key(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !expanded.value || view.value) return
  const root = toggleButton.value?.getRootNode() as ShadowRoot | undefined
  expanded.value = false
  void nextTick().then(() => {
    const focusCollapsed = () => {
      const collapsed = root?.querySelector<HTMLButtonElement>('.booster-dock-toggle')
      ;(collapsed ?? toggleButton.value)?.focus({ preventScroll: true })
    }
    focusCollapsed()
    requestAnimationFrame(focusCollapsed)
  })
}
onMounted(async () => {
  window.addEventListener('resize', resize); window.addEventListener('keydown', key)
  window.addEventListener(OPEN_SETTINGS_EVENT, openSettings); window.addEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onOpenCapture)
  window.addEventListener(OPEN_ARCHIVE_EVENT, onOpenArchive); window.addEventListener(ARCHIVE_UPDATED_EVENT, onArchive)
  window.addEventListener(HISTORY_LOADER_STATE_EVENT, onState)
  window.dispatchEvent(new Event('chatgpt-booster:history-loader-query'))
  try {
    const next = await props.settingsAdapter.get()
    if (!alive) return
    settings.value = snapshotSettings(next)
    unsubscribe = props.settingsAdapter.subscribe(next => { if (!dragging.value) settings.value = snapshotSettings(next) })
  } catch { error.value = 'common.saveError' }
  if (!alive) return
  if (props.archiveAdapter?.subscribeContextChange)
    contextUnsubscribe = props.archiveAdapter.subscribeContextChange(() => {
      if (opened.value || archiveOpen.value) void refreshContext()
    })
  else
    contextFallbackTimer = setInterval(() => {
      if (document.hidden || (!opened.value && !archiveOpen.value)) return
      if (props.archiveAdapter?.currentConversationId() !== context.value.conversationId)
        void refreshContext()
    }, 450)
})
onBeforeUnmount(() => {
  alive = false; revision++; unsubscribe?.(); contextUnsubscribe?.(); clearInterval(contextFallbackTimer); clearTimeout(archiveRefreshTimer)
  window.removeEventListener('resize', resize); window.removeEventListener('keydown', key)
  window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings); window.removeEventListener(OPEN_CAPTURE_SETTINGS_EVENT, onOpenCapture)
  window.removeEventListener(OPEN_ARCHIVE_EVENT, onOpenArchive); window.removeEventListener(ARCHIVE_UPDATED_EVENT, onArchive)
  window.removeEventListener(HISTORY_LOADER_STATE_EVENT, onState)
})
</script>
<template>
  <div class="booster-overlay-root" :lang="locale">
    <ArchiveWorkspace v-if="archiveOpen && archiveAdapter" :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :initial-conversation-id="archiveInitial" :locale="locale" @close="archiveOpen = false" @export="(id, title) => openExport(id, title, true)" />
    <ModalSurface v-if="view === 'settings'" :label="t('dock.settings')" @close="view = null"><ControlCenterPanel v-bind="props" show-close @close="view = null" /></ModalSurface>
    <ModalSurface v-if="view === 'capture'" :label="t('capture.title')" @close="view = null"><CaptureSettingsSurface :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :context="captureContext" :locale="locale" @close="view = null" /></ModalSurface>
    <ModalSurface v-if="view === 'export' && archiveAdapter && exportTarget" :label="t('export.title')" @close="closeView"><ArchiveExportDialog :archive-adapter="archiveAdapter" :settings-adapter="settingsAdapter" :conversation-id="exportTarget.id" :title="exportTarget.title" :locale="locale" @close="closeView" /></ModalSurface>
    <div class="booster-dock" :class="[side, growsUp ? 'grow-up' : 'grow-down', { dragging }]" :style="{ left: position.x + 'px', top: position.y + 'px' }">
      <div v-if="expanded && !dragging" class="booster-dock-shell" :style="{ maxHeight: shellMaxHeight + 'px' }">
        <div class="booster-dock-content" :style="{ maxHeight: Math.max(0, shellMaxHeight - SIZE) + 'px' }">
          <section class="booster-dock-context">
            <CopyIdentity :label="context.conversationTitle || t(context.conversationId ? 'identity.untitled' : 'dock.noChat')" :identifier="context.conversationId" :locale="locale" />
            <CopyIdentity v-if="context.projectId" :label="context.projectTitle || t('identity.unknownProject')" :identifier="context.projectId" :locale="locale" />
            <div v-if="context.conversationId" class="booster-dock-counts"><span>{{ t('dock.messages') }} <b>{{ cachedMessageCount }}</b></span><span>{{ t('dock.details') }} {{ cachedDetailCount }}</span></div>
            <p v-if="coverage" class="booster-dock-history-state">{{ t(coverage.hasOlderServerHistory === true ? 'dock.olderAvailable' : coverage.hasOlderServerHistory === false ? 'dock.startReached' : 'dock.historyUnknown') }}</p>
            <p v-else-if="loading">{{ t('reader.loading') }}</p>
            <button class="booster-capture-shortcut" type="button" @click="openCapture(currentCaptureTarget)"><ShieldCheck class="size-3" />{{ t(captureStatusKey) }}</button>
          </section>
          <div v-if="active" class="booster-dock-progress" role="status"><span>{{ t(`phase.${loader.phase}`) }} · {{ t('dock.messages') }}: {{ loader.knownMessageCount }} · {{ t('dock.pages') }}: {{ loader.pagesLoaded }}</span><button class="booster-icon-button" type="button" :aria-label="t('dock.stop')" @click="stop"><Square class="size-3" /></button></div>
          <p v-if="loader.phase === 'error' && loader.conversationId === context.conversationId" role="alert" class="booster-error">{{ t(safeError(new Error(loader.message))) }}</p><p v-if="error" class="booster-error" role="alert">{{ t(error) }}</p>
          <nav class="booster-dock-actions" :aria-label="t('dock.title')">
            <button type="button" :disabled="!savedChat || !context.conversationId" @click="context.conversationId && openExport(context.conversationId, context.conversationTitle)"><Download class="size-4" />{{ t('dock.export') }}</button>
            <button type="button" :disabled="!context.conversationId || active" @click="collect"><ArrowUpToLine class="size-4" />{{ t('dock.collect') }}</button>
            <button type="button" :disabled="!archiveAdapter" @click="openArchive()"><Archive class="size-4" />{{ t('dock.archive') }}</button>
            <button type="button" @click="openSettings"><Settings class="size-4" />{{ t('dock.settings') }}</button>
          </nav>
        </div>
        <button ref="toggleButton" class="booster-dock-close-bar" type="button" :aria-label="t('dock.close')" :title="t('dock.close') + ' · ' + t('dock.drag')" @click="toggle" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelPointer"><X class="size-5" /><span>{{ t('dock.closeShort') }}</span></button>
      </div>
      <button v-else ref="toggleButton" class="booster-dock-toggle" type="button" :aria-label="t(opened ? 'dock.close' : 'dock.open')" :title="t(opened ? 'dock.close' : 'dock.open') + ' · ' + t('dock.drag')" :aria-expanded="opened" @click="toggle" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelPointer"><X v-if="opened" class="size-5" /><Layers3 v-else class="size-5" /></button>
    </div>
  </div>
</template>
