<script setup lang="ts">
/*
 * Shared responsive workspace and integrated edge toolkit.
 * Providers contribute capabilities and views; presentation owns no data operations.
 */
import {
  type FeatureIndicator,
  type FeatureRuntime,
  SHELL_CLOSE_EVENT,
  SHELL_OPEN_FEATURE_EVENT,
  SHELL_RESTORE_UI_EVENT,
  shellInstanceKey,
} from '@kobaproduction/browser-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  ModalSurface,
  Switch,
  useApplicationLocale,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import {
  type Viewport,
  type WorkspaceRatios,
  type WorkspaceRect,
  workspaceRatios,
  workspaceRect,
} from '@kobaproduction/browser-widgets'
import { Grip, GripVertical, Layers3, Minus, X } from 'lucide-vue-next'
import { type Component, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type ApplicationIdentity, resolveApplicationIdentity } from './application'
import ControlCenterPanel from './ControlCenterPanel.vue'
import LauncherIndicators from './LauncherIndicators.vue'
import { clampLauncher, dropLauncher, launcherMenuGeometry } from './launcher-geometry'
import { indicatorDescription, launcherIndicatorTone } from './launcher-indicators'
import QuickMenu from './QuickMenu.vue'
import SiteToolsEntry from './SiteToolsEntry.vue'
import {
  COMMON_SETTINGS_CATEGORIES,
  providerSettingsCategory,
  validSettingsCatalogId,
} from './settings-catalog'
import { SHELL_UI_MESSAGES } from './ui-messages'

const props = defineProps<{
  runtime: FeatureRuntime
  views: Record<string, Component>
  title: string
  application?: ApplicationIdentity
  launcher: boolean
}>()
const locale = useApplicationLocale()
const text = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
const caption = useLocalizedText(SHELL_UI_MESSAGES)
const open = ref(false)
const mobile = ref(window.innerWidth <= 620)
const quickOpen = ref(false)
let quickDismissedOutside = false
watch(
  quickOpen,
  (visible) => {
    if (visible) quickDismissedOutside = false
  },
  { flush: 'sync' },
)
const viewportHeight = ref(window.innerHeight)
const quickBusy = ref(false)
const quickError = ref('')
const quickMetrics = ref<readonly import('@kobaproduction/browser-core').FeatureQuickMetric[]>([])
const indicators = ref<readonly FeatureIndicator[]>([])
const unsubscribeIndicators: (() => void)[] = []
let metricsRevision = 0
const runtimeRevision = ref(0)
const siteEntryAvailable = ref(false)
const shellPreferences = computed(() => {
  void runtimeRevision.value
  return props.runtime.shellPreferences()
})
const launcherVisible = computed(() => props.launcher && shellPreferences.value.launcher)
const applicationIdentity = computed(() =>
  resolveApplicationIdentity(props.runtime, props.title, props.application),
)
let unsubscribeRuntime: (() => void) | undefined
let unsubscribeQuickContext: (() => void) | undefined
const installationEnabled = computed(() => {
  void runtimeRevision.value
  return props.runtime.isRunning()
})
const featureActive = computed(() => {
  void runtimeRevision.value
  return props.runtime.list().find((x) => x.id === singleFeature.value?.id)?.state === 'active'
})
const launcherButton = ref<HTMLButtonElement>()
function setLauncherButton(value: unknown) {
  const element =
    value && typeof value === 'object' && '$el' in value ? (value as { $el?: unknown }).$el : value
  launcherButton.value = element instanceof HTMLButtonElement ? element : undefined
}
const matchingFeatures = computed(() =>
  props.runtime.features.filter((feature) => feature.match(props.runtime.context.url)),
)
const standalone = computed(() => matchingFeatures.value.length === 1)

const singleFeature = computed(() => (standalone.value ? matchingFeatures.value[0] : undefined))
const menuActions = computed(() => {
  void runtimeRevision.value
  void quickOpen.value
  const actions: readonly import('@kobaproduction/browser-core').FeatureQuickAction[] = singleFeature
    .value?.quickActions?.length
    ? singleFeature.value.quickActions
    : [
        {
          id: 'open',
          label: text('Открыть панель', 'Open panel'),
          icon: 'open' as const,
          after: 'open-panel' as const,
          run: () => undefined,
        },
      ]
  return actions
    .filter((action) => action.visible?.() !== false)
    .map((action) =>
      action.moduleId
        ? {
            ...action,
            enabled: () =>
              (action.availableWhenDisabled ||
                props.runtime
                  .moduleList()
                  .some(
                    (module) =>
                      module.featureId === singleFeature.value?.id &&
                      module.id === action.moduleId &&
                      module.state === 'active',
                  )) &&
              action.enabled?.() !== false,
          }
        : action,
    )
})
let quickContextGeneration = 0
function rebindQuickContext() {
  const generation = ++quickContextGeneration
  try {
    unsubscribeQuickContext?.()
  } catch {
    /* Provider cleanup cannot detach the Shell. */
  }
  unsubscribeQuickContext = undefined
  try {
    unsubscribeQuickContext = singleFeature.value?.subscribeQuickContext?.(() => {
      if (generation !== quickContextGeneration) return
      runtimeRevision.value++
      if (quickOpen.value) void refreshQuickMetrics()
    })
  } catch {
    /* A stopped capability may temporarily have no context port. */
  }
  if (quickOpen.value) void refreshQuickMetrics()
  bindIndicators()
}
function refreshIndicators() {
  const values: FeatureIndicator[] = []
  for (const feature of matchingFeatures.value)
    try {
      for (const indicator of feature.indicators?.current() ?? [])
        values.push({ ...indicator, id: `${feature.id}:${indicator.id}` })
    } catch {
      /* A stopped provider can temporarily expose no signals. */
    }
  indicators.value = values
}
function bindIndicators() {
  for (const stop of unsubscribeIndicators.splice(0))
    try {
      stop()
    } catch {}
  for (const feature of matchingFeatures.value)
    try {
      const stop = feature.indicators?.subscribe(refreshIndicators)
      if (stop) unsubscribeIndicators.push(stop)
    } catch {}
  refreshIndicators()
}
watch(singleFeature, rebindQuickContext, { immediate: true })
const dockSide = ref<'left' | 'right'>('right')
const attached = ref(true)
const dockRatio = ref(0.45)
const edgeKey = 'koba-browser:edge-launcher'
// A dedicated single-module Booster opens directly to its feature.
// Multi-module installations start at the contributed settings catalog.
const configuredSections = Object.keys(props.views)
const selectedSection = ref(
  configuredSections.length === 1 ? (configuredSections[0] ?? 'shell-settings') : 'shell-settings',
)
const settingsCategory = ref('interface')
const SESSION_KEY = 'koba-browser:session-ui'
let sessionReady = false
function restoreSession() {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(shellInstanceKey(SESSION_KEY)) || 'null')
    if (!saved || typeof saved !== 'object') return
    const value = saved as { surface?: unknown; section?: unknown; category?: unknown }
    open.value = false
    quickOpen.value = false
    if (
      typeof value.section === 'string' &&
      ['shell-settings', ...configuredSections].includes(value.section)
    )
      selectedSection.value = value.section
    if (typeof value.category === 'string' && validSettingsCatalogId(props.runtime, value.category)) {
      settingsCategory.value = value.category
      const provider = providerSettingsCategory(props.runtime, value.category)
      if (provider?.feature.id === selectedSection.value)
        void Promise.resolve(provider.feature.settings?.restoreCategory?.(provider.categoryId)).catch(
          () => {},
        )
    }
    if (value.surface === 'panel') open.value = true
    else if (value.surface === 'quick' && standalone.value) {
      quickOpen.value = true
      void refreshQuickMetrics()
    }
  } catch {
    /* Session restoration never affects provider operations. */
  }
}
watch([open, quickOpen, selectedSection, settingsCategory], () => {
  if (!sessionReady) return
  try {
    sessionStorage.setItem(
      shellInstanceKey(SESSION_KEY),
      JSON.stringify({
        surface: open.value ? 'panel' : quickOpen.value ? 'quick' : 'closed',
        section: selectedSection.value,
        category: settingsCategory.value,
      }),
    )
  } catch {
    /* Private UI state stays optional when browser storage is unavailable. */
  }
})
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
const BUTTON_SIZE = 44,
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

function dockPosition() {
  const margin = 0
  const maxY = Math.max(margin, window.innerHeight - BUTTON_SIZE - margin)
  position.value = {
    x: dockSide.value === 'left' ? margin : Math.max(margin, window.innerWidth - BUTTON_SIZE - margin),
    y: Math.max(margin, Math.min(maxY, dockRatio.value * maxY)),
  }
}
function restoreEdge() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(shellInstanceKey(edgeKey)) || 'null')
    if (saved && typeof saved === 'object') {
      const value = saved as { side?: string | null; ratio?: number; xRatio?: number; yRatio?: number }
      if (
        value.side === null &&
        typeof value.xRatio === 'number' &&
        Number.isFinite(value.xRatio) &&
        typeof value.yRatio === 'number' &&
        Number.isFinite(value.yRatio)
      ) {
        attached.value = false
        position.value = clampLauncher(
          {
            x: value.xRatio * (window.innerWidth - BUTTON_SIZE),
            y: value.yRatio * (window.innerHeight - BUTTON_SIZE),
          },
          viewport(),
        )
        dockSide.value = position.value.x + BUTTON_SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right'
        return
      }
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
      shellInstanceKey(edgeKey),
      JSON.stringify({
        side: attached.value ? dockSide.value : null,
        ratio: dockRatio.value,
        xRatio: position.value.x / Math.max(1, window.innerWidth - BUTTON_SIZE),
        yRatio: position.value.y / Math.max(1, window.innerHeight - BUTTON_SIZE),
      }),
    )
  } catch {
    /* Docking remains functional */
  }
}
function restore() {
  restoreEdge()
}
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const expanded = rect.width > BUTTON_SIZE + 2
  dragStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: expanded ? event.clientX - BUTTON_SIZE / 2 : position.value.x,
    y: expanded ? event.clientY - BUTTON_SIZE / 2 : position.value.y,
    moved: false,
  }
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
    if (!dragStart.moved) quickOpen.value = false
    dragStart.moved = true
    dragging.value = true
    attached.value = false
  }
  if (!dragStart.moved) return
  position.value = clampLauncher({ x: dragStart.x + dx, y: dragStart.y + dy }, viewport())
}
function onPointerUp(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return
  const moved = dragStart.moved
  dragStart = undefined
  dragging.value = false
  if (moved) {
    const next = dropLauncher(position.value, viewport())
    position.value = { x: next.x, y: next.y }
    attached.value = next.side !== null
    dockSide.value = next.side ?? (next.x + BUTTON_SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right')
    dockRatio.value = next.y / Math.max(1, window.innerHeight - BUTTON_SIZE)
    storeEdge()
  } else void activateLauncher()
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
  // First opening follows the user's persisted launcher edge.
  let ratios: WorkspaceRatios = {
    ...DEFAULT_WORKSPACE,
    xRatio: dockSide.value === 'left' ? 0 : 1,
  }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(shellInstanceKey(WORKSPACE_KEY)) || 'null')
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
      shellInstanceKey(WORKSPACE_KEY),
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
  updateWorkspaceRect(workspace.value)
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
  if (!shellPreferences.value.metrics || !feature?.quickMetrics || !featureActive.value) {
    quickMetrics.value = []
    return
  }
  try {
    const values = await feature.quickMetrics()
    if (sequence === metricsRevision && quickOpen.value)
      quickMetrics.value = values.filter(
        (metric) =>
          !metric.moduleId ||
          props.runtime
            .moduleList()
            .some(
              (module) =>
                module.featureId === feature.id &&
                module.id === metric.moduleId &&
                module.state === 'active',
            ),
      )
  } catch {
    /* No sensitive provider data leaks into the shared shell. */
    if (sequence === metricsRevision) quickMetrics.value = []
  }
}
async function activateLauncher() {
  if (minimized.value) {
    openPanel()
    return
  }
  if (!shellPreferences.value.quickMenu) {
    openSettings()
    return
  }
  const click = singleFeature.value?.launcher
  if (click?.mode === 'action') {
    if (quickBusy.value) return
    quickBusy.value = true
    try {
      await click.run?.()
    } catch {
      quickError.value = text(
        'Не удалось выполнить действие кнопки',
        'Could not run the launcher action',
      )
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
  if (id === 'settings') {
    openSettings()
    return
  }
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
    quickError.value = text('Не удалось открыть действие', 'Could not open the action')
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
    quickError.value = text(
      'Не удалось изменить состояние установки',
      'Could not change the installation state',
    )
  } finally {
    quickBusy.value = false
  }
}
function onResize() {
  // A viewport change invalidates the pointer's starting rectangle. Cancel the
  // gesture before rebasing both rendered and persisted geometry together.
  workspaceDrag = undefined
  mobile.value = window.innerWidth <= 620
  viewportHeight.value = window.innerHeight
  if (attached.value) dockPosition()
  else position.value = clampLauncher(position.value, viewport())
  const nextViewport = viewport()
  workspace.value = workspaceRect(workspaceRatios(workspace.value, lastViewport), nextViewport)
  lastViewport = nextViewport
}
function quickInteractOutside(event: CustomEvent<{ originalEvent: Event }>) {
  // Launcher activation/drag owns its toggle. Reka owns all other dismissal.
  if (event.detail.originalEvent.composedPath().includes(launcherButton.value as EventTarget)) {
    event.preventDefault()
    return
  }
  // A nonmodal outside interaction belongs to the site. Returning focus to the
  // launcher here would steal the user's first click/keystroke from its target.
  quickDismissedOutside = true
}
function quickCloseAutoFocus(event: Event) {
  event.preventDefault()
  if (!open.value && !quickDismissedOutside) launcherButton.value?.focus()
}
function onModuleOpen(event: Event) {
  const detail = (event as CustomEvent<{ id?: string }>).detail
  selectedSection.value = detail?.id && props.views[detail.id] ? detail.id : 'shell-settings'
  openPanel()
}
const menuGeometry = computed(() =>
  launcherMenuGeometry(
    position.value,
    { width: window.innerWidth, height: viewportHeight.value },
    dockSide.value,
  ),
)
const launcherStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  '--booster-dock-width': `${menuGeometry.value.width}px`,
  '--booster-dock-offset-x': `${menuGeometry.value.offsetX}px`,
}))
const growsUp = computed(() => menuGeometry.value.growsUp)
// Card owns a one-pixel border at each end of the scrollable content.
const quickMenuStyle = computed(() => ({
  maxHeight: `${Math.max(0, menuGeometry.value.contentHeight - 2)}px`,
}))
const mobileSurfaceStyle = {
  left: '0px',
  top: '0px',
  width: '100dvw',
  height: '100dvh',
  translate: 'none',
  transform: 'none',
}
const indicatorLabel = computed(() =>
  indicators.value
    .map((indicator) => indicatorDescription(indicator, caption, locale.value === 'en'))
    .join('; '),
)
const indicatorTone = computed(() => launcherIndicatorTone(indicators.value))
const workspaceStyle = computed(() => {
  // Rendering and pointer motion consume the same normalized rectangle.
  const { width, height, x, y } = workspace.value
  return { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }
})
// Single-host installations also own a real floating workspace; a provider
// with one visible feature must not silently fall back to a centered modal.
const floatingPanel = computed(
  () =>
    !mobile.value &&
    (Boolean(singleFeature.value) ||
      props.runtime.features.some(
        (feature) => feature.id === selectedSection.value && feature.presentation?.panel === 'wide',
      )),
)
watch(floatingPanel, (floating) => {
  if (!floating) workspaceDrag = undefined
})
function openPanel() {
  workspaceDrag = undefined
  updateWorkspaceRect(workspace.value)
  quickOpen.value = false
  open.value = true
  minimized.value = false
}
function openSettings(categoryId?: string) {
  const provider = categoryId ? providerSettingsCategory(props.runtime, categoryId) : undefined
  if (
    categoryId &&
    provider &&
    props.views[provider.feature.id] &&
    provider.feature.settings?.restoreCategory
  ) {
    settingsCategory.value = categoryId
    selectedSection.value = provider.feature.id
    void Promise.resolve(provider.feature.settings.restoreCategory(provider.categoryId)).catch(() => {
      if (selectedSection.value === provider.feature.id && settingsCategory.value === categoryId) {
        settingsCategory.value = 'interface'
        selectedSection.value = 'shell-settings'
      }
    })
    openPanel()
    return
  }
  if (categoryId && COMMON_SETTINGS_CATEGORIES.some((id) => id === categoryId))
    settingsCategory.value = categoryId
  else if (!COMMON_SETTINGS_CATEGORIES.some((id) => id === settingsCategory.value))
    settingsCategory.value = 'interface'
  selectedSection.value = 'shell-settings'
  openPanel()
}
function openMenu() {
  if (!standalone.value) {
    openSettings()
    return
  }
  open.value = false
  minimized.value = false
  quickOpen.value = true
  void refreshQuickMetrics()
}
function closePanel() {
  workspaceDrag = undefined
  quickOpen.value = false
  ++metricsRevision
  open.value = false
  minimized.value = false
}
function onRestoreUi(event: Event) {
  const detail = (event as CustomEvent<{ layout?: boolean; session?: boolean }>).detail
  if (detail?.layout === true) {
    restore()
    restoreWorkspace()
  }
  if (detail?.session === true) restoreSession()
}
defineExpose({ openPanel, closePanel, openSettings, openMenu })
onMounted(() => {
  unsubscribeRuntime = props.runtime.subscribe(() => {
    runtimeRevision.value++
    rebindQuickContext()
  })
  restore()
  restoreWorkspace()
  restoreSession()
  sessionReady = true
  window.addEventListener('resize', onResize)
  window.addEventListener(SHELL_OPEN_FEATURE_EVENT, onModuleOpen)
  window.addEventListener(SHELL_CLOSE_EVENT, closePanel)
  window.addEventListener(SHELL_RESTORE_UI_EVENT, onRestoreUi)
})
onBeforeUnmount(() => {
  ++metricsRevision
  unsubscribeRuntime?.()
  quickContextGeneration++
  try {
    unsubscribeQuickContext?.()
  } catch {}
  for (const stop of unsubscribeIndicators.splice(0))
    try {
      stop()
    } catch {}
  workspaceDrag = undefined
  window.removeEventListener('resize', onResize)
  window.removeEventListener(SHELL_OPEN_FEATURE_EVENT, onModuleOpen)
  window.removeEventListener(SHELL_CLOSE_EVENT, closePanel)
  window.removeEventListener(SHELL_RESTORE_UI_EVENT, onRestoreUi)
})
</script>

<template>
  <div class="booster-overlay-root">
    <SiteToolsEntry v-if="shellPreferences.siteEntry" @settings="openSettings" @menu="openMenu" @available="siteEntryAvailable = $event" />
    <ModalSurface v-if="open" :label="applicationIdentity.title"
      :fullscreen="mobile"
      :floating="floatingPanel" :surface-style="mobile ? mobileSurfaceStyle : floatingPanel ? workspaceStyle : undefined"
      :surface-class="mobile ? 'booster-modal-surface booster-modal-fullscreen' : floatingPanel ? 'booster-modal-surface booster-modal-surface-wide' : 'booster-modal-surface'" @close="closePanel">
      <template v-if="floatingPanel" #chrome>
        <div class="booster-floating-chrome" :aria-label="text('Переместить рабочее окно', 'Move workspace')"
          @pointerdown="onWorkspaceDown($event, 'move')" @pointermove="onWorkspaceMove"
          @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp">
          <Button type="button" variant="ghost" size="icon" class="booster-floating-handle"
            :title="text('Переместить окно — стрелки', 'Move window with arrow keys')" :aria-label="text('Переместить окно — используйте стрелки', 'Move window using arrow keys')"
            @pointerdown.stop="onWorkspaceDown($event, 'move')"
            @pointermove="onWorkspaceMove" @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp"
            @keydown="onWorkspaceKey($event, 'move')"><GripVertical class="size-4" aria-hidden="true" /></Button>
          <span class="booster-floating-identity">{{ applicationIdentity.title }}<small v-if="applicationIdentity.version" class="booster-version">{{ applicationIdentity.version }}</small></span>
          <Switch :model-value="installationEnabled" :disabled="quickBusy" :aria-label="installationEnabled ? text('Отключить функции расширения', 'Disable extension features') : text('Включить функции расширения', 'Enable extension features')" @update:model-value="toggleQuickInstallation" />
          <Button v-if="launcherVisible" type="button" variant="ghost" size="icon" :title="text('Свернуть окно', 'Minimize window')" :aria-label="text('Свернуть окно', 'Minimize window')"
            @click="minimizeWorkspace"><Minus class="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon" :title="text('Закрыть окно', 'Close window')" :aria-label="text('Закрыть окно', 'Close window')"
            @click="closePanel"><X class="size-4" /></Button>
        </div>
      </template>
      <p v-if="quickError" class="booster-workspace-error" role="alert">{{quickError}}</p>
      <ControlCenterPanel :runtime="runtime" :views="views" :title="applicationIdentity.title" :application="applicationIdentity" :selected-section="selectedSection" :settings-category="settingsCategory" :floating="floatingPanel" :site-entry-available="siteEntryAvailable" @category="settingsCategory = $event" @select="selectedSection = $event" @close="closePanel" />
      <template v-if="floatingPanel" #handles>
        <Button type="button" variant="ghost" size="icon" class="booster-floating-resize" :aria-label="text('Изменить размер окна — используйте стрелки', 'Resize window using arrow keys')"
          @pointerdown="onWorkspaceDown($event, 'resize')" @pointermove="onWorkspaceMove"
          @pointerup="onWorkspaceUp" @pointercancel="onWorkspaceUp"
          @keydown="onWorkspaceKey($event, 'resize')"><Grip class="size-4" /></Button>
      </template>
    </ModalSurface>
    <div v-if="(launcherVisible || quickOpen || dragging) && (!standalone || !open)" class="booster-edge-toolkit"
      :class="[dockSide, attached ? 'attached' : 'free', growsUp ? 'grow-up' : 'grow-down']" :style="launcherStyle">
      <Dialog v-if="standalone && singleFeature" v-model:open="quickOpen" :modal="false">
      <DialogContent v-if="!dragging" portal-disabled hide-overlay hide-close-button :aria-describedby="undefined"
        class="booster-edge-shell z-auto block max-w-none gap-0 p-0 translate-x-0 translate-y-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
        style="translate: none; transform: none; animation: none;"
        @interact-outside="quickInteractOutside" @close-auto-focus="quickCloseAutoFocus">
        <DialogTitle class="sr-only">{{ applicationIdentity.title }}: {{ text('инструменты', 'tools') }}</DialogTitle>
        <QuickMenu :style="quickMenuStyle" :title="applicationIdentity.title" :version="applicationIdentity.version" :indicators="indicators"
          :enabled="installationEnabled" :active="featureActive"
          :busy="quickBusy" :actions="menuActions" :metrics="shellPreferences.metrics ? quickMetrics : []"
          @select="selectQuick" @toggle="toggleQuickInstallation" />
      </DialogContent>
      </Dialog>
    <p v-if="quickOpen && quickError" class="booster-quick-error" role="alert">{{ quickError }}</p>
    <Button
      :ref="setLauncherButton"
      :variant="quickOpen ? 'ghost' : 'default'"
      class="booster-launcher p-0"
      :data-indicator-tone="quickOpen ? 'idle' : indicatorTone"
      :class="{ 'booster-launcher-dragging': dragging, 'booster-launcher-docked': attached, 'booster-launcher-floating': !attached || dragging, 'booster-edge-close-bar': quickOpen && !dragging }"
      type="button"
      :title="indicatorLabel || `${text('Открыть', 'Open')} ${applicationIdentity.title}`"
      aria-haspopup="dialog"
:aria-expanded="standalone ? quickOpen : open"
      :aria-label="`${minimized ? text('Восстановить окно', 'Restore window') : !shellPreferences.quickMenu ? text('Открыть настройки', 'Open settings') : quickOpen ? text('Закрыть быстрое меню', 'Close quick menu') : text('Открыть быстрое меню', 'Open quick menu')}${indicatorLabel ? '. ' + indicatorLabel : ''}`"
      @click="onLauncherClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragStart=undefined;dragging=false"
    >
      <X v-if="standalone ? quickOpen : open" class="booster-launcher-icon" aria-hidden="true" />
      <Layers3 v-else class="booster-launcher-icon" aria-hidden="true" />
      <span v-if="quickOpen && !dragging">{{ text('Свернуть', 'Collapse') }}</span>
      <LauncherIndicators v-if="!quickOpen && indicators.length" :indicators="indicators" compact />
    </Button>
    </div>
  </div>
</template>
