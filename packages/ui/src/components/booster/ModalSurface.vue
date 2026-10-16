<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'

const props = defineProps<{
  label: string
  wide?: boolean
  surfaceClass?: string
  floating?: boolean
  fullscreen?: boolean
  surfaceStyle?: Record<string, string>
}>()
const emit = defineEmits<{ close: [] }>()
function interactOutside(event: Event) {
  if (props.floating) event.preventDefault()
}
</script>
<template>
  <Dialog :open="true" :modal="!floating" @update:open="!$event && emit('close')">
    <DialogContent :hide-close-button="true" :aria-label="label" :aria-describedby="undefined"
      :overlay-class="['booster-modal-backdrop', { 'booster-modal-backdrop-floating': floating, 'booster-modal-backdrop-fullscreen': fullscreen }]"
      class="booster-dialog flex max-w-none flex-col gap-0 overflow-hidden p-0"
      :class="[
        surfaceClass,
        { 'booster-dialog-wide': wide, 'booster-dialog-floating': floating },
        (floating || fullscreen) && 'translate-x-0 translate-y-0 data-[state=open]:animate-none data-[state=closed]:animate-none',
        fullscreen && 'inset-0 h-dvh w-dvw max-w-none rounded-none border-0',
      ]" :style="surfaceStyle"
      @interact-outside="interactOutside" @escape-key-down="$event.stopPropagation()">
      <DialogTitle class="sr-only">{{ label }}</DialogTitle>
      <slot name="chrome" /><slot /><slot name="handles" />
    </DialogContent>
  </Dialog>
</template>
