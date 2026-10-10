<script setup lang="ts">
import Archive from 'lucide-vue-next/dist/esm/icons/archive.js'
import { OPEN_ARCHIVE_EVENT } from '@chatgpt-booster/core'
import Maximize2 from 'lucide-vue-next/dist/esm/icons/maximize-2.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {clamp,workspaceRect,workspaceRatios,dockedIconStyle,dockedIconRatios} from '@kobaproduction/browser-widgets'
import type { ArchiveWindowSettings, SettingsAdapter, ArchiveMessageLocation } from '@chatgpt-booster/core'
import ArchiveBrowser from './ArchiveBrowser.vue'
import type { ArchiveDataAdapter } from './mount'
import type { SupportedLocale } from './i18n'

const props = defineProps<{
  settingsAdapter: SettingsAdapter
  archiveAdapter: ArchiveDataAdapter
  initialConversationId?: string | null | undefined
  locale: SupportedLocale
  navigationTarget?: ArchiveMessageLocation | null
  suspended?: boolean
  canReturnToExport?: boolean
}>()
const emit = defineEmits<{
  close: []
  returnExport: []
  export: [conversationId: string, title: string | null]
}>()

const ready = ref(false)
const minimized = ref(false)
const openPosition = ref<'first' | 'latest'>('latest')
const viewport = ref({ width: innerWidth, height: innerHeight })
const settings = ref<ArchiveWindowSettings>()
const transient = ref<{ x: number; y: number; width: number; height: number }>()
let alive = true
let unsubscribe: (() => void) | undefined
let iconMoved = false
let drag:
  | { kind: 'move' | 'resize' | 'icon'; id: number; x: number; y: number; start: { x: number; y: number; width: number; height: number } }
  | undefined

const geometry = computed(() =>
  transient.value ?? workspaceRect(settings.value ?? {
    xRatio: 0.08,
    yRatio: 0.08,
    widthRatio: 0.72,
    heightRatio: 0.82,
  }, viewport.value),
)
const windowStyle = computed(() => ({
  left: `${geometry.value.x}px`,
  top: `${geometry.value.y}px`,
  width: `${geometry.value.width}px`,
  height: `${geometry.value.height}px`,
}))
const iconStyle = computed(() => dockedIconStyle(settings.value,viewport.value))

async function persistGeometry(next = geometry.value) {
  const patch = workspaceRatios(next,viewport.value)
  const updated = await props.settingsAdapter.update({ ui: { archiveWindow: patch } })
  settings.value = { ...updated.ui.archiveWindow }
}
async function persistMinimized(x: number, y: number) {
  const updated = await props.settingsAdapter.update({
    ui: { archiveWindow: dockedIconRatios(x,y,viewport.value) },
  })
  settings.value = { ...updated.ui.archiveWindow }
}
function pointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement
  const isResize = Boolean(target.closest('[data-archive-resize]'))
  if (!isResize && target.closest('button,a,input,select,textarea,[role="button"]')) return
  const isMove = Boolean(target.closest('[data-archive-drag-handle]'))
  if (!isResize && !isMove) return
  if (event.button !== 0) return
  const g = geometry.value
  drag = {
    kind: isResize ? 'resize' : 'move',
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    start: { ...g },
  }
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch {}
}
function iconPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  iconMoved = false
  drag = {
    kind: 'icon',
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    start: { x: event.clientX, y: event.clientY, width: 42, height: 42 },
  }
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch {}
}
function pointerMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (drag.kind === 'icon') {
    if (Math.hypot(dx, dy) > 5) iconMoved = true
    const node = event.currentTarget as HTMLElement
    node.style.left = `${clamp(event.clientX - 21, 0, viewport.value.width - 42)}px`
    node.style.top = `${clamp(event.clientY - 21, 0, viewport.value.height - 42)}px`
    return
  }
  if (drag.kind === 'move') {
    transient.value = {
      ...drag.start,
      x: clamp(drag.start.x + dx, 8, viewport.value.width - drag.start.width - 8),
      y: clamp(drag.start.y + dy, 8, viewport.value.height - drag.start.height - 8),
    }
    return
  }
  transient.value = {
    ...drag.start,
    width: clamp(drag.start.width + dx, 520, viewport.value.width - drag.start.x - 8),
    height: clamp(drag.start.height + dy, 360, viewport.value.height - drag.start.y - 8),
  }
}
async function pointerUp(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  const current = drag
  drag = undefined
  if (current.kind === 'icon') {
    const node = event.currentTarget as HTMLElement
    const rect = node.getBoundingClientRect()
    await persistMinimized(rect.left, rect.top)
    node.style.removeProperty('left')
    node.style.removeProperty('top')
    return
  }
  if (transient.value) {
    const next = transient.value
    transient.value = undefined
    await persistGeometry(next)
  }
}
function cancelPointer() {
  drag = undefined
  transient.value = undefined
}
function restoreFromDock() {
  if (iconMoved) {
    iconMoved = false
    return
  }
  minimized.value = false
}
async function minimize() {
  const g = geometry.value
  await persistMinimized(g.x + g.width / 2, g.y + 22)
  minimized.value = true
}
function resizeViewport() {
  viewport.value = { width: innerWidth, height: innerHeight }
  transient.value = undefined
}

watch(() => props.navigationTarget, (target) => { if (target) minimized.value = false })
onMounted(async () => {
  const current = await props.settingsAdapter.get()
  if (!alive) return
  settings.value = { ...current.ui.archiveWindow }
  openPosition.value = current.ui.archiveStart
  unsubscribe = props.settingsAdapter.subscribe((next) => {
    if (!drag) settings.value = { ...next.ui.archiveWindow }
    openPosition.value = next.ui.archiveStart
  })
  addEventListener('resize', resizeViewport)
  addEventListener(OPEN_ARCHIVE_EVENT, restoreFromDock)
  addEventListener('chatgpt-booster:restore-archive', restoreFromDock)
  ready.value = true
})
onBeforeUnmount(() => {
  alive = false
  unsubscribe?.()
  removeEventListener('resize', resizeViewport)
  removeEventListener(OPEN_ARCHIVE_EVENT, restoreFromDock)
  removeEventListener('chatgpt-booster:restore-archive', restoreFromDock)
})
</script>

<template>
  <div v-if="ready" class="booster-archive-workspace-root">
    <button
      v-if="minimized"
      class="booster-archive-dock-button"
      type="button"
      :style="iconStyle"
      :title="locale === 'ru' ? 'Развернуть архив' : 'Restore archive'"
      @click="restoreFromDock"
      @pointerdown="iconPointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="cancelPointer"
    ><Archive class="size-5" /><Maximize2 class="booster-archive-dock-corner" /></button>

    <section
      v-show="!minimized"
      class="booster-archive-workspace"
      :style="windowStyle"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="cancelPointer"
    >
      <ArchiveBrowser
        :archive-adapter="archiveAdapter"
        :initial-conversation-id="initialConversationId"
        :navigation-target="navigationTarget ?? null"
        :suspended="!!suspended || minimized"
        :can-return-to-export="canReturnToExport"
        @return-export="emit('returnExport')"
        :open-position="openPosition"
        :locale="locale"
        windowed
        @minimize="minimize"
        @close="emit('close')"
        @export="(id, title) => emit('export', id, title)"
      />
      <button data-archive-resize class="booster-archive-resize" type="button" tabindex="-1" aria-hidden="true" />
    </section>
  </div>
</template>
