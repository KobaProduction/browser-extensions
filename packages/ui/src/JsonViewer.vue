<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ value: unknown }>()
function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
function highlight(value: unknown) {
  const source = JSON.stringify(value, null, 2) ?? 'null'
  const token = /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:)?|"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g
  let output = ''
  let last = 0
  for (const match of source.matchAll(token)) {
    const index = match.index ?? 0
    output += escapeHtml(source.slice(last, index))
    const raw = match[0]
    let type = 'number'
    if (raw.startsWith('"')) type = source.slice(index + raw.length).match(/^\s*:/) ? 'key' : 'string'
    else if (raw === 'true' || raw === 'false') type = 'boolean'
    else if (raw === 'null') type = 'null'
    output += `<span class="booster-json-${type}">${escapeHtml(raw)}</span>`
    last = index + raw.length
  }
  return output + escapeHtml(source.slice(last))
}
const html = computed(() => highlight(props.value))
</script>
<template><pre class="booster-json-viewer" v-html="html" /></template>
