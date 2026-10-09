<script setup lang="ts">
/*
 * Launcher and centered modal follow ChatGPT Booster's BoosterOverlay.vue:
 * draggable side button, persisted/clamped position, central modal.
 * Adaptation: feature registry and module views instead of ChatGPT settings.
 */
import type { FeatureRuntime } from '@kobaproduction/browser-core'
import { ModalSurface } from '@kobaproduction/browser-ui'
import { GripVertical } from 'lucide-vue-next'
import { type Component, computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
    const saved = JSON.parse(localStorage.getItem('koba-browser:launcher-position') || 'null')
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
    localStorage.setItem('koba-browser:launcher-position', JSON.stringify(position.value))
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
  else open.value = !open.value
}
function onResize() {
  const p = clampPosition(position.value.x, position.value.y)
  if (p.x !== position.value.x || p.y !== position.value.y) {
    position.value = p
    savePosition()
  }
}
function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}
function onModuleOpen(event: Event) {
  const detail = (event as CustomEvent<{ id?: string }>).detail
  selectedSection.value = detail?.id || 'modules'
  open.value = true
}
const launcherStyle = computed(() => ({ left: position.value.x + 'px', top: position.value.y + 'px' }))
function openPanel() {
  open.value = true
}
function closePanel() {
  open.value = false
}
defineExpose({ openPanel, closePanel })
onMounted(() => {
  restore()
  window.addEventListener('resize', onResize)
  window.addEventListener('koba:open-feature', onModuleOpen)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('koba:open-feature', onModuleOpen)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="booster-overlay-root">
    <ModalSurface v-if="open" :label="title" surface-class="booster-modal-surface" @close="closePanel">
      <ControlCenterPanel :runtime="runtime" :views="views" :title="title" :selected-section="selectedSection" @close="closePanel" />
    </ModalSurface>
    <button
      v-if="launcher"
      class="booster-launcher"
      :class="{ 'booster-launcher-dragging': dragging }"
      :style="launcherStyle"
      type="button"
      title="Открыть Koba Browser Tools"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart=undefined;dragging=false"
    >
      <GripVertical class="booster-launcher-grip" /><span>B</span>
    </button>
  </div>
</template>
