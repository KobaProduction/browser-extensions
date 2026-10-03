<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next'
import { onBeforeUnmount, ref } from 'vue'
import { translate, type SupportedLocale } from './i18n'
const props = defineProps<{ label: string; identifier?: string | null; locale: SupportedLocale }>()
const state = ref<'copy' | 'copied' | 'failed'>('copy')
let timer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  if (!props.identifier) return
  try { await navigator.clipboard.writeText(props.identifier); state.value = 'copied' }
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
