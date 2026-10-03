<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next'
import { onBeforeUnmount, ref } from 'vue'
import { translate, type SupportedLocale } from './i18n'
const props = defineProps<{ label: string; identifier?: string | null; locale: SupportedLocale }>()
const state = ref<'copy' | 'copied' | 'failed'>('copy')
let timer: ReturnType<typeof setTimeout> | undefined
async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard unavailable')
}
async function copy() {
  if (!props.identifier) return
  try { await writeClipboard(props.identifier); state.value = 'copied' }
  catch { state.value = 'failed' }
  clearTimeout(timer)
  timer = setTimeout(() => { state.value = 'copy' }, 2000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <span class="booster-identity">
    <span class="booster-identity-label" :title="label">{{ label }}</span>
    <button v-if="identifier" type="button" class="booster-identity-copy" :aria-label="translate(locale, `identity.${state}`)" :title="translate(locale, `identity.${state}`)" @click.stop.prevent="copy">
      <Check v-if="state === 'copied'" class="size-3" /><Copy v-else class="size-3" />
    </button>
    <span v-if="state !== 'copy'" class="booster-sr-only" role="status">{{ translate(locale, `identity.${state}`) }}</span>
  </span>
</template>
