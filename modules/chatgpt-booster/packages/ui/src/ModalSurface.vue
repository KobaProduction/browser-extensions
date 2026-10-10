<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{ label: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const root = ref<HTMLElement>()
let restore: HTMLElement | null = null
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab' || !root.value) return
  const items = [...root.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(item => item.getClientRects().length)
  const first = items[0], last = items.at(-1)
  const active = (root.value.getRootNode() as ShadowRoot).activeElement
  if (!first || !last) { event.preventDefault(); root.value.focus(); return }
  if (event.shiftKey && (active === first || active === root.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (active === last || active === root.value)) { event.preventDefault(); first.focus() }
}
onMounted(async () => {
  const shadow = root.value?.getRootNode() as ShadowRoot | undefined
  restore = shadow?.activeElement as HTMLElement | null
  await nextTick()
  root.value?.focus()
})
onBeforeUnmount(() => { if (restore?.isConnected) restore.focus() })
</script>
<template>
  <div class="booster-modal-backdrop" @click.self="emit('close')">
    <section ref="root" tabindex="-1" role="dialog" aria-modal="true" :aria-label="props.label" class="booster-dialog" :class="{ 'booster-dialog-wide': wide }" @keydown="key"><slot /></section>
  </div>
</template>
