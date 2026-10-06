<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    mode?: 'hover' | 'click'
    label: string
    align?: 'start' | 'end'
    triggerClass?: string
  }>(),
  { mode: 'hover', align: 'end' },
)

const trigger = ref<HTMLElement>()
const popup = ref<HTMLElement>()
const open = ref(false)

function position() {
  const button = trigger.value
  const panel = popup.value
  if (!button || !panel) return
  const rect = button.getBoundingClientRect()
  const width = Math.min(340, Math.max(180, panel.offsetWidth || 260))
  const maxLeft = Math.max(8, innerWidth - width - 8)
  const preferred = props.align === 'start' ? rect.left : rect.right - width
  const left = Math.max(8, Math.min(maxLeft, preferred))
  const panelHeight = panel.offsetHeight || 80
  const below = rect.bottom + 8
  const top = below + panelHeight <= innerHeight - 8 ? below : Math.max(8, rect.top - panelHeight - 8)
  panel.style.left = left + 'px'
  panel.style.top = top + 'px'
}

function bindOpenListeners() {
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
  if (props.mode === 'click') document.addEventListener('pointerdown', onPointerDown, true)
}

function unbindOpenListeners() {
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
}

async function show() {
  if (open.value) {
    position()
    return
  }
  open.value = true
  bindOpenListeners()
  await nextTick()
  const panel = popup.value
  if (!panel) return
  try {
    if ('showPopover' in panel) panel.showPopover()
  } catch {}
  position()
}

function hide() {
  if (!open.value) return
  open.value = false
  unbindOpenListeners()
  const panel = popup.value
  try {
    if (panel && 'hidePopover' in panel) panel.hidePopover()
  } catch {}
}

function toggle() {
  if (open.value) hide()
  else void show()
}

function onPointerDown(event: PointerEvent) {
  if (props.mode !== 'click' || !open.value) return
  const path = event.composedPath()
  if (trigger.value && path.includes(trigger.value)) return
  if (popup.value && path.includes(popup.value)) return
  hide()
}

function reposition() {
  if (open.value) position()
}

onBeforeUnmount(() => {
  unbindOpenListeners()
})
</script>

<template>
  <span
    ref="trigger"
    class="booster-meta-trigger"
    :class="[triggerClass, { 'is-clickable': mode === 'click' }]"
    tabindex="0"
    role="button"
    :aria-label="label"
    :title="label"
    @mouseenter="mode === 'hover' && show()"
    @mouseleave="mode === 'hover' && hide()"
    @focus="mode === 'hover' && show()"
    @blur="mode === 'hover' && hide()"
    @click.stop="mode === 'click' && toggle()"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
    @keydown.escape.prevent="hide"
  >
    <slot name="trigger" />
  </span>
  <div
    ref="popup"
    class="booster-floating-popover"
    :class="{ 'is-interactive': mode === 'click', 'is-open': open }"
    popover="manual"
  >
    <slot />
  </div>
</template>
