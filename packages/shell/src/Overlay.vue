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
import QuickMenu from './QuickMenu.vue'

const props = defineProps<{
  runtime: FeatureRuntime
  views: Record<string, Component>
  title: string
  launcher: boolean
}>()
const open = ref(false)
const quickOpen = ref(false)
const quickBusy = ref(false)
const quickError = ref('')
const quickMetrics = ref<readonly import('@kobaproduction/browser-core').FeatureQuickMetric[]>([])
let metricsRevision = 0
const runtimeRevision = ref(0)
let unsubscribeRuntime: (() => void) | undefined
const installationEnabled = computed(() => {
  void runtimeRevision.value
  return props.runtime.isRunning()
})
const featureActive = computed(() => {
  void runtimeRevision.value
  return props.runtime.list().find((x) => x.id === singleFeature.value?.id)?.state === 'active'
})
const launcherButton = ref<HTMLButtonElement>()
const matchingFeatures = computed(() =>
  props.runtime.features.filter((feature) => feature.match(props.runtime.context.url)),
)
const standalone = computed(() => matchingFeatures.value.length === 1)

const singleFeature = computed(() => (standalone.value ? matchingFeatures.value[0] : undefined))
const menuActions = computed(() =>
  singleFeature.value?.quickActions?.length
    ? singleFeature.value.quickActions
    : [
        {
          id: 'open',
          label: 'Открыть панель',
          icon: 'open' as const,
          after: 'open-panel' as const,
          run: () => undefined,
        },
      ],
)
const dockSide = ref<'left' | 'right'>('right')
const dockRatio = ref(0.45)
const edgeKey = 'koba-browser:edge-launcher'
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
function dockPosition() {
  const margin = 3
  const maxY = Math.max(margin, window.innerHeight - BUTTON_SIZE - margin)
  position.value = {
    x: dockSide.value === 'left' ? margin : Math.max(margin, window.innerWidth - BUTTON_SIZE - margin),
    y: Math.max(margin, Math.min(maxY, dockRatio.value * maxY)),
  }
}
function restoreEdge() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(instanceKey(edgeKey)) || 'null')
    if (saved && typeof saved === 'object') {
      const value = saved as { side?: string; ratio?: number }
      if (
        (value.side === 'left' || value.side === 'right') &&
        typeof value.ratio === 'number' &&
        Number.isFinite(value.ratio)
      ) {
        dockSide.value = value.side
        dockRatio.value = Math.max(0, Math.min(1, value.ratio))
      }
    }
  } catch {
    /* Storage unavailable */
  }
  dockPosition()
}
function storeEdge() {
  try {
    localStorage.setItem(
      instanceKey(edgeKey),
      JSON.stringify({ side: dockSide.value, ratio: dockRatio.value }),
    )
  } catch {
    /* Docking remains functional */
  }
}
function restore() {
  if (standalone.value) {
    restoreEdge()
    return
  }
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
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    /* Synthetic events. */
  }
}
function onPointerMove(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return
  const dx = event.clientX - dragStart.clientX,
    dy = event.clientY - dragStart.clientY
  if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
    if (!dragStart.moved && standalone.value) quickOpen.value = false
    dragStart.moved = true
  }
  position.value = clampPosition(dragStart.x + dx, dragStart.y + dy)
}
function onPointerUp(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return
  const moved = dragStart.moved
  dragStart = undefined
  dragging.value = false
  if (moved && standalone.value) {
    dockSide.value = position.value.x + BUTTON_SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right'
    dockRatio.value = position.value.y / Math.max(1, window.innerHeight - BUTTON_SIZE - 3)
    dockPosition()
    storeEdge()
  } else if (moved) savePosition()
  else void activateLauncher()
}
// Pointer activation is handled on pointerup to distinguish a drag from a tap.
// Keyboard and assistive technology activate buttons through click (detail=0).
// Ignore pointer-generated clicks so a mouse/touch tap never toggles twice.
function onLauncherClick(event: MouseEvent) {
  if (event.detail === 0) void activateLauncher()
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
async function refreshQuickMetrics() {
  const feature = singleFeature.value
  const sequence = ++metricsRevision
  quickMetrics.value = []
  if (!feature?.quickMetrics || !featureActive.value) return
  try {
    const values = await feature.quickMetrics()
    if (sequence === metricsRevision && quickOpen.value) quickMetrics.value = values
  } catch {
    /* No sensitive provider data leaks into the shared shell. */
  }
}
async function activateLauncher() {
  const click = singleFeature.value?.launcher
  if (click?.mode === 'action') {
    if (quickBusy.value) return
    quickBusy.value = true
    try {
      await click.run?.()
    } catch {
      quickError.value = 'Не удалось выполнить действие кнопки'
    } finally {
      quickBusy.value = false
    }
    return
  }
  if (click?.mode === 'panel') {
    openPanel()
    return
  }
  toggleLauncher()
}
function toggleLauncher() {
  if (standalone.value) {
    quickOpen.value = !quickOpen.value
    if (quickOpen.value) {
      open.value = false
      void refreshQuickMetrics()
    }
    return
  }
  open.value = !open.value
  if (open.value) minimized.value = false
}
async function selectQuick(id: string) {
  const action = menuActions.value.find((item) => item.id === id)
  if (
    !action ||
    quickBusy.value ||
    (!props.runtime.isRunning() && !action.availableWhenDisabled) ||
    action.enabled?.() === false
  )
    return
  quickBusy.value = true
  quickError.value = ''
  try {
    await action.run()
    if (action.after === 'open-panel') openPanel()
    else if (action.after !== 'keep-menu') quickOpen.value = false
  } catch {
    quickError.value = 'Не удалось открыть действие'
  } finally {
    quickBusy.value = false
  }
}
async function toggleQuickInstallation() {
  if (quickBusy.value) return
  quickBusy.value = true
  quickError.value = ''
  try {
    await props.runtime.setRunning(!props.runtime.isRunning())
  } catch {
    quickError.value = 'Не удалось изменить состояние установки'
  } finally {
    quickBusy.value = false
  }
}
function onResize() {
  if (standalone.value) dockPosition()
  if (!workspaceDrag) {
    const nextViewport = viewport()
    workspace.value = workspaceRect(workspaceRatios(workspace.value, lastViewport), nextViewport)
    lastViewport = nextViewport
  }
  if (standalone.value) return
  const p = clampPosition(position.value.x, position.value.y)
  if (p.x !== position.value.x || p.y !== position.value.y) {
    position.value = p
    savePosition()
  }
}
function onOutsidePress(event: PointerEvent) {
  if (!quickOpen.value) return
  const path = event.composedPath()
  if (
    path.includes(launcherButton.value as EventTarget) ||
    path.some((node) => node instanceof HTMLElement && node.classList.contains('booster-quick-menu'))
  )
    return
  quickOpen.value = false
}
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (quickOpen.value) {
    quickOpen.value = false
    launcherButton.value?.focus()
    return
  }
  if (open.value) closePanel()
}
function onModuleOpen(event: Event) {
  const detail = (event as CustomEvent<{ id?: string }>).detail
  selectedSection.value = detail?.id || 'modules'
  quickOpen.value = false
  open.value = true
  minimized.value = false
}
const launcherStyle = computed(() => ({ left: position.value.x + 'px', top: position.value.y + 'px' }))
const quickMenuStyle = computed(() => ({
  top: Math.max(8, Math.min(position.value.y - 110, window.innerHeight - 320)) + 'px',
  ...(dockSide.value === 'right' ? { right: BUTTON_SIZE + 6 + 'px' } : { left: BUTTON_SIZE + 6 + 'px' }),
}))
const workspaceStyle = computed(() => ({
  left: workspace.value.x + 'px',
  top: workspace.value.y + 'px',
  width: workspace.value.width + 'px',
  height: workspace.value.height + 'px',
}))
const widePanel = computed(
  () =>
    !standalone.value &&
    props.runtime.features.some(
      (feature) => feature.id === selectedSection.value && feature.presentation?.panel === 'wide',
    ),
)
watch(widePanel, (wide) => {
  if (!wide) workspaceDrag = undefined
})
function openPanel() {
  quickOpen.value = false
  open.value = true
  minimized.value = false
}
function closePanel() {
  quickOpen.value = false
  ++metricsRevision
  open.value = false
  minimized.value = false
}
defineExpose({ openPanel, closePanel })
onMounted(() => {
  unsubscribeRuntime = props.runtime.subscribe(() => {
    runtimeRevision.value++
  })
  restore()
  restoreWorkspace()
  window.addEventListener('resize', onResize)
  window.addEventListener(SHELL_OPEN_FEATURE_EVENT, onModuleOpen)
  window.addEventListener(SHELL_CLOSE_EVENT, closePanel)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onOutsidePress, true)
})
onBeforeUnmount(() => {
  ++metricsRevision
  unsubscribeRuntime?.()
  workspaceDrag = undefined
  window.removeEventListener('resize', onResize)
  window.removeEventListener(SHELL_OPEN_FEATURE_EVENT, onModuleOpen)
  window.removeEventListener(SHELL_CLOSE_EVENT, closePanel)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('pointerdown', onOutsidePress, true)
})
</script>

<template>
  <div class="booster-overlay-root">
    <ModalSurface v-if="open" :label="singleFeature?.title || title"
      :floating="widePanel" :surface-style="widePanel ? workspaceStyle : undefined"
      :surface-class="standalone ? 'booster-modal-surface booster-modal-surface-single' : widePanel ? 'booster-modal-surface booster-modal-surface-wide' : 'booster-modal-surface'" @close="closePanel">
      <template v-if="widePanel" #chrome>
        <div class="booster-floating-chrome" aria-label="Переместить рабочее окно"
          @pointerdown="onWorkspaceDown($event, 'move')" @pointermove="onWorkspaceMove"
          @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp">
          <button type="button" class="booster-floating-handle"
            title="Переместить окно — стрелки" aria-label="Переместить окно — используйте стрелки"
            @pointerdown.stop="onWorkspaceDown($event, 'move')"
            @pointermove="onWorkspaceMove" @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp"
            @keydown="onWorkspaceKey($event, 'move')"><GripVertical class="size-4" aria-hidden="true" /></button>
          <span>{{ title }} · {{ selectedSection }}</span>
          <button v-if="launcher" type="button" title="Свернуть окно" aria-label="Свернуть окно"
            @click="minimizeWorkspace"><Minus class="size-4" /></button>
          <button type="button" title="Закрыть окно" aria-label="Закрыть окно"
            @click="closePanel"><X class="size-4" /></button>
        </div>
      </template>
      <ControlCenterPanel :runtime="runtime" :views="views" :title="singleFeature?.title || title" :selected-section="selectedSection" @select="selectedSection = $event" @close="closePanel" />
      <template v-if="widePanel" #handles>
        <button type="button" class="booster-floating-resize" aria-label="Изменить размер окна — используйте стрелки"
          @pointerdown="onWorkspaceDown($event, 'resize')" @pointermove="onWorkspaceMove"
          @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp"
          @keydown="onWorkspaceKey($event, 'resize')"><Grip class="size-4" /></button>
      </template>
    </ModalSurface>
    <QuickMenu v-if="quickOpen && standalone && singleFeature" :style="quickMenuStyle"
      :title="singleFeature.title" :version="singleFeature.presentation?.version"
      :installation="singleFeature.presentation?.installation"
      :enabled="installationEnabled" :active="featureActive"
      :busy="quickBusy" :actions="menuActions" :metrics="quickMetrics"
      @close="quickOpen = false; launcherButton?.focus()"
      @select="selectQuick" @toggle="toggleQuickInstallation" />
    <p v-if="quickOpen && quickError" class="booster-quick-error" role="alert">{{ quickError }}</p>
    <button
      v-if="launcher"
      ref="launcherButton"
      class="booster-launcher"
      :class="{ 'booster-launcher-dragging': dragging, 'booster-launcher-docked': standalone }"
      :style="launcherStyle"
      type="button"
      title="Открыть Koba Browser Tools"
      aria-haspopup="dialog"
:aria-expanded="standalone ? quickOpen : open"
      :aria-label="standalone ? (quickOpen ? 'Закрыть быстрое меню' : 'Открыть быстрое меню') : minimized ? 'Восстановить окно' : 'Открыть или закрыть панель'"
      @click="onLauncherClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart=undefined;dragging=false"
    >
      <X v-if="standalone ? quickOpen : open" class="booster-launcher-icon" aria-hidden="true" />
      <Layers3 v-else class="booster-launcher-icon" aria-hidden="true" />
    </button>
  </div>
</template>
