<script setup lang="ts">
import type { ArchiveItemView } from '@chatgpt-booster/core'
import { computed, ref } from 'vue'
import { translate, type SupportedLocale } from './i18n'
const props = defineProps<{ item: ArchiveItemView; locale: SupportedLocale }>()
const rawOpen = ref(false)
const raw = computed(() => rawOpen.value ? JSON.stringify(props.item.record.raw, null, 2) : '')
</script>
<template>
  <section class="booster-record" :class="`booster-record-${item.kind}`">
    <header><strong>{{ translate(locale, `reader.${item.kind}`) }}</strong><span v-if="item.record.recipient && item.record.recipient !== 'all'">{{ item.record.recipient }}</span><span v-if="item.record.modelSlug">{{ item.record.modelSlug }}</span><span v-if="item.record.status" class="booster-record-status">{{ item.record.status }}</span></header>
    <div class="booster-record-text">{{ item.text || translate(locale, 'reader.noText') }}</div>
    <details class="booster-record-raw" @toggle="rawOpen = ($event.target as HTMLDetailsElement).open"><summary>{{ translate(locale, 'reader.raw') }}</summary><pre v-if="rawOpen">{{ raw }}</pre></details>
  </section>
</template>
