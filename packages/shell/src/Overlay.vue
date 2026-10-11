<script setup lang="ts">
/*
 * Launcher and centered modal follow ChatGPT Booster's BoosterOverlay.vue:
 * draggable side button, persisted/clamped position, central modal.
 * Adaptation: feature registry and module views instead of ChatGPT settings.
 */
import {
  type FeatureRuntime,
  instanceKey,
  SHELL_CLOSE_EVENT,
  SHELL_OPEN_FEATURE_EVENT,
} from '@kobaproduction/browser-core'
import { ModalSurface } from '@kobaproduction/browser-ui'
import {
  type Viewport,
  type WorkspaceRatios,
  type WorkspaceRect,
  workspaceRatios,
  workspaceRect,
} from '@kobaproduction/browser-widgets'
import { Grip, GripVertical, Layers3, Minus, X } from 'lucide-vue-next'
import { type Component, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ControlCenterPanel from './ControlCenterPanel.vue'

const props = defineProps<{
  runtime: FeatureRuntime
  views: Record<string, Component>
  title: string
  launcher: boolean
}>()
const open = ref(false)
// A dedicated single-module Booster opens directly to its feature.
// Multi-module installations keep the module index as their entry point.
const configuredSections = Object.keys(props.views)
const selectedSection = ref(
  configuredSections.length === 1 ? (configuredSections[0] ?? 'modules') : 'modules',
)
const position = ref({ x: 0, y: 0 })
const dragging = ref(false)
const minimized = ref(false)
const workspace = ref<WorkspaceRect>({ x: 0, y: 0, width: 720, height: 640 })
let lastViewport: Viewport = { width: 1024, height: 768 }
const DEFAULT_WORKSPACE: WorkspaceRatios = {
  xRatio: 0.08,
  yRatio: 0.08,
  widthRatio: 0.72,
  heightRatio: 0.82,
}
const WORKSPACE_KEY = 'koba-browser:floating-workspace'
let workspaceDrag:
  | { pointerId: number; kind: 'move' | 'resize'; startX: number; startY: number; rect: WorkspaceRect }
  | undefined
const BUTTON_SIZE = 46,
  VIEWPORT_MARGIN = 12,
  DRAG_THRESHOLD = 4
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
function restore() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(instanceKey('koba-browser:launcher-position')) || 'null',
    )
    if (typeof saved?.x === 'number' && typeof saved?.y === 'number') {
      position.value = clampPosition(saved.x, saved.y)
      return
    }
  } catch {
    /* browser storage unavailable */
  }
  position.value = defaultPosition()
}
function savePosition() {
  try {
    localStorage.setItem(instanceKey('koba-browser:launcher-position'), JSON.stringify(position.value))
  } catch {
    /* browser storage unavailable */
  }
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
  const dx = event.clientX - dragStart.clientX,
    dy = event.clientY - dragStart.clientY
  if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) dragStart.moved = true
  position.value = clampPosition(dragStart.x + dx, dragStart.y + dy)
}
function onPointerUp(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return
  const moved = dragStart.moved
  dragStart = undefined
  dragging.value = false
  if (moved) savePosition()
  else toggleLauncher()
}
// Pointer activation is handled on pointerup to distinguish a drag from a tap.
// Keyboard and assistive technology activate buttons through click (detail=0).
// Ignore pointer-generated clicks so a mouse/touch tap never toggles twice.
function onLauncherClick(event: MouseEvent) {
  if (event.detail === 0) toggleLauncher()
}
function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}
function restoreWorkspace() {
  lastViewport = viewport()
  let ratios = DEFAULT_WORKSPACE
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(instanceKey(WORKSPACE_KEY)) || 'null')
    if (
      saved &&
      typeof saved === 'object' &&
      ['xRatio', 'yRatio', 'widthRatio', 'heightRatio'].every((key) => {
        const value: unknown = (saved as Record<string, unknown>)[key]
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      })
    ) {
      ratios = saved as WorkspaceRatios
    }
  } catch {
    /* storage or saved geometry unavailable */
  }
  workspace.value = workspaceRect(ratios, lastViewport)
}
function saveWorkspace() {
  try {
    localStorage.setItem(
      instanceKey(WORKSPACE_KEY),
      JSON.stringify(workspaceRatios(workspace.value, viewport())),
    )
  } catch {
    /* ephemeral geometry is still usable */
  }
}
function updateWorkspaceRect(next: WorkspaceRect) {
  workspace.value = workspaceRect(workspaceRatios(next, viewport()), viewport())
}
function onWorkspaceDown(event: PointerEvent, kind: 'move' | 'resize') {
  if (event.button !== 0) return
  // The chrome has real buttons; their clicks must not initiate a drag.
  if (kind === 'move' && (event.target as HTMLElement).closest('button:not(.booster-floating-handle)'))
    return
  workspaceDrag = {
    pointerId: event.pointerId,
    kind,
    startX: event.clientX,
    startY: event.clientY,
    rect: { ...workspace.value },
  }
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {}
  event.preventDefault()
}
function onWorkspaceMove(event: PointerEvent) {
  const drag = workspaceDrag
  if (!drag || event.pointerId !== drag.pointerId) return
  const dx = event.clientX - drag.startX,
    dy = event.clientY - drag.startY
  updateWorkspaceRect(
    drag.kind === 'move'
      ? { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }
      : { ...drag.rect, width: drag.rect.width + dx, height: drag.rect.height + dy },
  )
}
function onWorkspaceUp(event: PointerEvent) {
  if (!workspaceDrag || event.pointerId !== workspaceDrag.pointerId) return
  workspaceDrag = undefined
  saveWorkspace()
}
function onWorkspaceKey(event: KeyboardEvent, kind: 'move' | 'resize') {
  const movement: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const step = movement[event.key]
  if (!step) return
  event.preventDefault()
  event.stopPropagation()
  const delta = event.shiftKey ? 48 : 16
  const [dx, dy] = step
  const rect = workspace.value
  updateWorkspaceRect(
    kind === 'move'
      ? { ...rect, x: rect.x + dx * delta, y: rect.y + dy * delta }
      : { ...rect, width: rect.width + dx * delta, height: rect.height + dy * delta },
  )
  saveWorkspace()
}
function minimizeWorkspace() {
  workspaceDrag = undefined
  minimized.value = true
  open.value = false
}
function toggleLauncher() {
  open.value = !open.value
  if (open.value) minimized.value = false
}
function onResize() {
  if (!workspaceDrag) {
    const nextViewport = viewport()
    workspace.value = workspaceRect(workspaceRatios(workspace.value, lastViewport), nextViewport)
    lastViewport = nextViewport
  }
  const p = clampPosition(position.value.x, position.value.y)
  if (p.x !== position.value.x || p.y !== position.value.y) {
    position.value = p
    savePosition()
  }
}
function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') closePanel()
}
function onModuleOpen(event: Event) {
  const detail = (event as CustomEvent<{ id?: string }>).detail
  selectedSection.value = detail?.id || 'modules'
  open.value = true
  minimized.value = false
}
const launcherStyle = computed(() => ({ left: position.value.x + 'px', top: position.value.y + 'px' }))
const workspaceStyle = computed(() => ({
  left: workspace.value.x + 'px',
  top: workspace.value.y + 'px',
  width: workspace.value.width + 'px',
  height: workspace.value.height + 'px',
}))
const widePanel = computed(() =>
  props.runtime.features.some(
    (feature) => feature.id === selectedSection.value && feature.presentation?.panel === 'wide',
  ),
)
watch(widePanel, (wide) => {
  if (!wide) workspaceDrag = undefined
})
function openPanel() {
  open.value = true
  minimized.value = false
}
function closePanel() {
  open.value = false
  minimized.value = false
}
defineExpose({ openPanel, closePanel })
onMounted(() => {
  restore()
  restoreWorkspace()
  window.addEventListener('resize', onResize)
  window.addEventListener(SHELL_OPEN_FEATURE_EVENT, onModuleOpen)
  window.addEventListener(SHELL_CLOSE_EVENT, closePanel)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  workspaceDrag = undefined
  window.removeEventListener('resize', onResize)
  window.removeEventListener(SHELL_OPEN_FEATURE_EVENT, onModuleOpen)
  window.removeEventListener(SHELL_CLOSE_EVENT, closePanel)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="booster-overlay-root">
    <ModalSurface v-if="open" :label="title"
      :floating="widePanel" :surface-style="widePanel ? workspaceStyle : undefined"
      :surface-class="widePanel ? 'booster-modal-surface booster-modal-surface-wide' : 'booster-modal-surface'" @close="closePanel">
      <template v-if="widePanel" #chrome>
        <div class="booster-floating-chrome" aria-label="Переместить окно ChatGPT Booster"
          @pointerdown="onWorkspaceDown($event, 'move')" @pointermove="onWorkspaceMove"
          @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp">
          <button type="button" class="booster-floating-handle"
            title="Переместить окно — стрелки" aria-label="Переместить окно — используйте стрелки"
            @pointerdown.stop="onWorkspaceDown($event, 'move')"
            @pointermove="onWorkspaceMove" @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp"
            @keydown="onWorkspaceKey($event, 'move')"><GripVertical class="size-4" aria-hidden="true" /></button>
          <span>ChatGPT Booster · {{ title }}</span>
          <button v-if="launcher" type="button" title="Свернуть окно" aria-label="Свернуть окно"
            @click="minimizeWorkspace"><Minus class="size-4" /></button>
          <button type="button" title="Закрыть окно" aria-label="Закрыть окно"
            @click="closePanel"><X class="size-4" /></button>
        </div>
      </template>
      <ControlCenterPanel :runtime="runtime" :views="views" :title="title" :selected-section="selectedSection" @select="selectedSection = $event" @close="closePanel" />
      <template v-if="widePanel" #handles>
        <button type="button" class="booster-floating-resize" aria-label="Изменить размер окна — используйте стрелки"
          @pointerdown="onWorkspaceDown($event, 'resize')" @pointermove="onWorkspaceMove"
          @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp"
          @keydown="onWorkspaceKey($event, 'resize')"><Grip class="size-4" /></button>
      </template>
    </ModalSurface>
    <button
      v-if="launcher"
      class="booster-launcher"
      :class="{ 'booster-launcher-dragging': dragging }"
      :style="launcherStyle"
      type="button"
      title="Открыть Koba Browser Tools"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="minimized ? 'Восстановить окно Koba Browser Tools' : 'Открыть или закрыть Koba Browser Tools'"
      @click="onLauncherClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart=undefined;dragging=false"
    >
      <X v-if="open" class="booster-launcher-icon" aria-hidden="true" />
      <Layers3 v-else class="booster-launcher-icon" aria-hidden="true" />
    </button>
  </div>
</template>
