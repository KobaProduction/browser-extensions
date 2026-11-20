<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kobaproduction/browser-ui'

defineOptions({ inheritAttrs: false })
defineProps<{ title: string; description: string; wide?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ closeAutoFocus: [event: Event] }>()
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent v-bind="$attrs" class="max-h-[85dvh] w-[calc(100vw-1.5rem)] overflow-y-auto"
      :class="wide && 'max-w-2xl'" @close-auto-focus="emit('closeAutoFocus', $event)">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <slot />
    </DialogContent>
  </Dialog>
</template>
