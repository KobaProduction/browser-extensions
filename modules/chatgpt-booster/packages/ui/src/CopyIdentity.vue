<script setup lang="ts">
import { Button } from '@kobaproduction/browser-ui'
import Check from 'lucide-vue-next/dist/esm/icons/check.js'
import Copy from 'lucide-vue-next/dist/esm/icons/copy.js'
import { onBeforeUnmount, ref } from 'vue'
import { type SupportedLocale, translate } from './i18n'

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
  try {
    await writeClipboard(props.identifier)
    state.value = 'copied'
  } catch {
    state.value = 'failed'
  }
  clearTimeout(timer)
  timer = setTimeout(() => {
    state.value = 'copy'
  }, 2000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <span class="booster-identity">
    <span class="booster-identity-label" :title="label">{{ label }}</span>
    <Button v-if="identifier" variant="ghost" size="icon" type="button" class="size-6 shrink-0" :aria-label="translate(locale, `identity.${state}`)" :title="translate(locale, `identity.${state}`)" @click.stop.prevent="copy">
      <Check v-if="state === 'copied'" class="size-3" /><Copy v-else class="size-3" />
    </Button>
    <span v-if="state !== 'copy'" class="booster-sr-only" role="status">{{ translate(locale, `identity.${state}`) }}</span>
  </span>
</template>
