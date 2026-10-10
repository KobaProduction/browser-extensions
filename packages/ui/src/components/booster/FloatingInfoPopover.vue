<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    mode?: 'hover' | 'click' | 'hover-click'
    label: string
    align?: 'start' | 'end'
    triggerClass?: string
  }>(),
  { mode: 'hover', align: 'end' },
)

const trigger = ref<HTMLElement>()
const popup = ref<HTMLElement>()
const open = ref(false)
const pinned = ref(false)
let hideTimer = 0

function position() {
  const button = trigger.value
  const panel = popup.value
  if (!button || !panel) return
  const rect = button.getBoundingClientRect()
  const width = Math.min(420, Math.max(180, panel.offsetWidth || 260))
  const maxLeft = Math.max(8, innerWidth - width - 8)
  const preferred = props.align === 'start' ? rect.left : rect.right - width
  const left = Math.max(8, Math.min(maxLeft, preferred))
  const panelHeight = panel.offsetHeight || 80
  const below = rect.bottom + 8
  const top = below + panelHeight <= innerHeight - 8 ? below : Math.max(8, rect.top - panelHeight - 8)
  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
}

function cancelHide() {
  if (!hideTimer) return
  window.clearTimeout(hideTimer)
  hideTimer = 0
}

function bindOpenListeners() {
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
  if (props.mode !== 'hover') document.addEventListener('pointerdown', onPointerDown, true)
}

function unbindOpenListeners() {
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
}

async function show() {
  cancelHide()
  if (open.value) {
    await nextTick()
    position()
    return
  }
  open.value = true
  bindOpenListeners()
  await nextTick()
  const panel = popup.value
  if (!panel) return
  try {
    panel.showPopover?.()
  } catch {}
  position()
}

function hide(force = false) {
  cancelHide()
  if (pinned.value && !force) return
  if (!open.value) {
    if (force) pinned.value = false
    return
  }
  open.value = false
  if (force) pinned.value = false
  unbindOpenListeners()
  try {
    popup.value?.hidePopover?.()
  } catch {}
}

function scheduleHide() {
  if (pinned.value) return
  cancelHide()
  hideTimer = window.setTimeout(() => hide(), 100)
}

function togglePinned() {
  if (props.mode === 'hover') return
  if (props.mode === 'click') {
    if (open.value) hide(true)
    else {
      pinned.value = true
      void show()
    }
    return
  }
  if (pinned.value) hide(true)
  else {
    pinned.value = true
    void show()
  }
}

function onPointerDown(event: PointerEvent) {
  if (!open.value || !pinned.value) return
  const path = event.composedPath()
  if (trigger.value && path.includes(trigger.value)) return
  if (popup.value && path.includes(popup.value)) return
  hide(true)
}

function reposition() {
  if (open.value) position()
}

function hoverEnter() {
  if (props.mode === 'click') return
  cancelHide()
  void show()
}

function hoverLeave() {
  if (props.mode === 'click') return
  if (props.mode === 'hover') hide()
  else scheduleHide()
}

onBeforeUnmount(() => {
  cancelHide()
  hide(true)
})
</script>

<template>
  <span
    ref="trigger"
    class="booster-meta-trigger"
    :class="[triggerClass, { 'is-clickable': mode !== 'hover' }]"
    tabindex="0"
    role="button"
    :aria-label="label"
    @mouseenter="hoverEnter"
    @mouseleave="hoverLeave"
    @focus="hoverEnter"
    @blur="mode === 'hover' && hide()"
    @click.stop="togglePinned"
    @keydown.enter.prevent="togglePinned"
    @keydown.space.prevent="togglePinned"
    @keydown.escape.prevent="hide(true)"
  >
    <slot name="trigger" />
  </span>
  <div
    ref="popup"
    class="booster-floating-popover"
    :class="{ 'is-interactive': pinned || mode === 'click', 'is-open': open }"
    popover="manual"
    @mouseenter="cancelHide"
    @mouseleave="hoverLeave"
  >
    <slot :pinned="pinned" :open="open" />
  </div>
</template>
