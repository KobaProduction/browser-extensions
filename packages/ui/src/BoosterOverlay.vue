<script setup lang="ts">
import { OPEN_SETTINGS_EVENT, type BoosterSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import { GripVertical } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ControlCenterPanel from './ControlCenterPanel.vue'

const props = defineProps<{
  settingsAdapter: SettingsAdapter
  target: 'extension' | 'userscript'
}>()

const BUTTON_SIZE = 46
const VIEWPORT_MARGIN = 12
const DRAG_THRESHOLD = 4

const open = ref(false)
const settings = ref<BoosterSettings>()
const position = ref({ x: 0, y: 0 })
const dragging = ref(false)
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

const launcherStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))

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
  settings.value.launcher = {
    x: Math.round(position.value.x),
    y: Math.round(position.value.y),
  }
  await props.settingsAdapter.set(structuredClone(settings.value))
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

  if (moved) await savePosition()
  else open.value = !open.value
}

function onResize() {
  const next = clampPosition(position.value.x, position.value.y)
  if (next.x === position.value.x && next.y === position.value.y) return
  position.value = next
  void savePosition()
}

function onOpenSettings() {
  open.value = true
}

onMounted(async () => {
  settings.value = await props.settingsAdapter.get()
  applyStoredPosition(settings.value)

  unsubscribe = props.settingsAdapter.subscribe((next) => {
    settings.value = structuredClone(next)
    if (!dragging.value) applyStoredPosition(next)
  })

  window.addEventListener('resize', onResize)
  window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  window.removeEventListener('resize', onResize)
  window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
})
</script>

<template>
  <div class="booster-overlay-root">
    <div v-if="open" class="booster-modal-backdrop" @click.self="open = false">
      <div class="booster-modal-surface">
        <ControlCenterPanel
          :settings-adapter="settingsAdapter"
          :target="target"
          show-close
          @close="open = false"
        />
      </div>
    </div>

    <button
      class="booster-launcher"
      :class="{ 'booster-launcher-dragging': dragging }"
      :style="launcherStyle"
      type="button"
      title="ChatGPT Booster — drag to move, click to open"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart = undefined; dragging = false"
    >
      <GripVertical class="booster-launcher-grip" />
      <span>B</span>
    </button>
  </div>
</template>
