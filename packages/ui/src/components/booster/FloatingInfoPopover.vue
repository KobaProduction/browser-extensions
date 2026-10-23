<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

const props = withDefaults(
  defineProps<{
    mode?: 'hover' | 'click' | 'hover-click'
    label: string
    align?: 'start' | 'end'
    triggerClass?: string
  }>(),
  { mode: 'hover', align: 'end' },
)

const open = ref(false)
const pinned = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined
let triggerToggle = false
let restoringFocus = false

function cancelHide() {
  if (hideTimer !== undefined) clearTimeout(hideTimer)
  hideTimer = undefined
}

function hoverEnter() {
  if (props.mode !== 'hover-click') return
  cancelHide()
  open.value = true
}

function hoverLeave() {
  if (props.mode !== 'hover-click' || pinned.value) return
  cancelHide()
  hideTimer = setTimeout(() => {
    open.value = false
  }, 120)
}

function triggerClick() {
  // A click pins the hover preview; the next click closes it. The registry
  // still owns trigger semantics, positioning, dismissal and focus handling.
  cancelHide()
  triggerToggle = true
  pinned.value = props.mode === 'click' ? !open.value : !pinned.value
  open.value = pinned.value
  // Browser microtask checkpoints can run between capture and bubble listeners.
  // Keep the guard for the whole click so the registry toggle cannot immediately
  // undo pinning/opening performed by the capture handler.
  setTimeout(() => {
    triggerToggle = false
  }, 0)
}

function updateOpen(value: boolean) {
  if (triggerToggle) return
  cancelHide()
  open.value = value
  if (!value) pinned.value = false
}

function focusTrigger() {
  if (!restoringFocus) hoverEnter()
}

function restoreTriggerFocus() {
  // Returning focus after Escape must not reopen the hover preview.
  restoringFocus = true
  queueMicrotask(() => {
    restoringFocus = false
  })
}

function openAutoFocus(event: Event) {
  if (!pinned.value) event.preventDefault()
}

onBeforeUnmount(cancelHide)
</script>

<template>
  <TooltipProvider v-if="mode === 'hover'" :delay-duration="150">
    <Tooltip v-model:open="open">
      <TooltipTrigger as-child>
        <Button type="button" variant="ghost" size="icon-sm" class="booster-meta-trigger size-7 text-muted-foreground" :class="triggerClass" :aria-label="label" @click.stop>
          <slot name="trigger" />
        </Button>
      </TooltipTrigger>
      <TooltipContent :align="align" :side-offset="8" :collision-padding="8" class="booster-floating-tooltip max-w-[min(420px,calc(100vw-16px))]">
        <slot :pinned="false" :open="open" />
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <Popover v-else :open="open" @update:open="updateOpen">
    <PopoverTrigger as-child>
      <Button
        type="button" variant="ghost" size="icon-sm"
        class="booster-meta-trigger size-7 text-muted-foreground" :class="triggerClass" :aria-label="label"
        @pointerenter="hoverEnter" @pointerleave="hoverLeave" @focus="focusTrigger"
        @blur="hoverLeave" @click.capture="triggerClick" @click.stop
      >
        <slot name="trigger" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      :align="align" :side-offset="8" :collision-padding="8"
      class="booster-floating-popover w-max max-w-[min(420px,calc(100vw-16px))] max-h-[var(--reka-popover-content-available-height)] overflow-y-auto p-3 text-xs"
      :class="{ 'is-interactive': pinned, 'is-open': open }"
      @pointerenter="cancelHide" @pointerleave="hoverLeave"
      @open-auto-focus="openAutoFocus" @close-auto-focus="restoreTriggerFocus"
    >
      <slot :pinned="pinned" :open="open" />
    </PopoverContent>
  </Popover>
</template>
