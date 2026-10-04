<script setup lang="ts">
import type { ArchiveItemView } from '@chatgpt-booster/core'
import { Brain, ChevronDown, ChevronRight, Code2, FileJson2, GitBranch, Github, Globe2, Image as ImageIcon, Play, Search, TerminalSquare, Wrench, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import JsonViewer from './JsonViewer.vue'
import MarkdownContent from './MarkdownContent.vue'
import ModalSurface from './ModalSurface.vue'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'

const props = withDefaults(
  defineProps<{ item: ArchiveItemView; locale: SupportedLocale; expandReasoning?: boolean }>(),
  { expandReasoning: false },
)
const expanded = ref(false)
const rawOpen = ref(false)
const runOpen = ref(false)
const t = (key: TranslationKey) => translate(props.locale, key)

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? null
}
const metadata = computed(() => object(props.item.record.raw.metadata))
const content = computed(() => object(props.item.record.raw.content))
const toolName = computed(() =>
  firstString(
    props.item.record.recipient && props.item.record.recipient !== 'all'
      ? props.item.record.recipient
      : null,
    props.item.record.authorName,
    metadata.value?.tool_name,
    metadata.value?.name,
    metadata.value?.connector_name,
    'tool',
  ),
)
function iconUrl(value: unknown, depth = 0): string | null {
  if (depth > 3) return null
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value
    try {
      const url = new URL(value)
      const host = url.hostname.toLowerCase()
      if (
        url.protocol === 'https:' &&
        (host === 'chatgpt.com' ||
          host.endsWith('.chatgpt.com') ||
          host === 'openai.com' ||
          host.endsWith('.openai.com') ||
          host === 'oaistatic.com' ||
          host.endsWith('.oaistatic.com'))
      )
        return url.href
    } catch {}
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = iconUrl(item, depth + 1)
      if (candidate) return candidate
    }
    return null
  }
  const record = object(value)
  if (!record) return null
  for (const key of ['url', 'icon_url', 'iconUrl', 'src', 'light', 'dark', 'default']) {
    const candidate = iconUrl(record[key], depth + 1)
    if (candidate) return candidate
  }
  for (const candidateValue of Object.values(record)) {
    const candidate = iconUrl(candidateValue, depth + 1)
    if (candidate) return candidate
  }
  return null
}
const toolIcon = computed(() => iconUrl(metadata.value?.tool_icons ?? metadata.value?.tool_icon))
const toolIconKey = computed(() => {
  const value = metadata.value?.tool_icons ?? metadata.value?.tool_icon
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && !first.includes('://') && !first.startsWith('data:')
    ? first.toLowerCase()
    : ''
})
const toolGlyph = computed(() => {
  const key = toolIconKey.value || toolName.value?.toLowerCase() || ''
  if (key.includes('globe') || key.includes('web')) return Globe2
  if (key.includes('github')) return Github
  if (key.includes('search')) return Search
  if (key.includes('terminal') || key.includes('shell')) return TerminalSquare
  if (key.includes('image')) return ImageIcon
  if (key.includes('git')) return GitBranch
  return Wrench
})
const isReasoningExpanded = computed(() => props.expandReasoning || expanded.value)
const preview = computed(() => {
  const text = props.item.text.trim()
  return text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text
})
const runPayload = computed(() => ({
  tool: toolName.value,
  recipient: props.item.record.recipient,
  messageId: props.item.record.messageId,
  status: props.item.record.status,
  content: content.value ?? props.item.record.raw.content ?? null,
  metadata: metadata.value ?? null,
}))
</script>

<template>
  <section class="booster-record" :class="`booster-record-${item.kind}`">
    <template v-if="item.kind === 'user' || item.kind === 'answer'">
      <header class="booster-record-header">
        <strong>{{ t(`reader.${item.kind}`) }}</strong>
        <span v-if="item.record.modelSlug">{{ item.record.modelSlug }}</span>
      </header>
      <MarkdownContent :text="item.text || t('reader.noText')" />
      <button class="booster-record-meta-button" type="button" @click="rawOpen = true"><FileJson2 class="size-3.5" />{{ t('reader.raw') }}</button>
    </template>

    <template v-else-if="item.kind === 'reasoning'">
      <header class="booster-record-header booster-record-internal-header">
        <span class="booster-record-kind"><Brain class="size-4" /><strong>{{ t('reader.reasoning') }}</strong></span>
        <button class="booster-record-expand" type="button" @click="expanded = !expanded">
          <ChevronDown v-if="isReasoningExpanded" class="size-3.5" /><ChevronRight v-else class="size-3.5" />
          {{ t(isReasoningExpanded ? 'reader.collapse' : 'reader.expand') }}
        </button>
      </header>
      <div class="booster-reasoning-preview" :class="{ expanded: isReasoningExpanded }">
        <MarkdownContent :text="item.text || t('reader.noText')" />
      </div>
      <button class="booster-record-meta-button" type="button" @click="rawOpen = true"><FileJson2 class="size-3.5" />{{ t('reader.raw') }}</button>
    </template>

    <template v-else-if="item.kind === 'tool_call' || item.kind === 'tool_result'">
      <div class="booster-tool-row">
        <img v-if="toolIcon" class="booster-tool-icon" :src="toolIcon" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span v-else class="booster-tool-icon booster-tool-icon-fallback"><component :is="toolGlyph" class="size-4" /></span>
        <div class="booster-tool-copy">
          <strong>{{ toolName }}</strong>
          <span>{{ t(`reader.${item.kind}`) }}</span>
          <p v-if="preview">{{ preview }}</p>
        </div>
        <div class="booster-tool-actions">
          <button type="button" class="booster-tool-action" @click="expanded = !expanded"><Code2 class="size-3.5" />{{ t(expanded ? 'reader.hide' : 'reader.show') }}</button>
          <button v-if="item.kind === 'tool_call'" type="button" class="booster-tool-action" @click="runOpen = true"><Play class="size-3.5" />Run</button>
          <button type="button" class="booster-tool-action" @click="rawOpen = true"><FileJson2 class="size-3.5" />Raw</button>
        </div>
      </div>
      <div v-if="expanded" class="booster-tool-expanded"><MarkdownContent :text="item.text || t('reader.noText')" /></div>
    </template>

    <template v-else>
      <button class="booster-internal-row" type="button" @click="expanded = !expanded">
        <span><Code2 class="size-4" /><strong>{{ t('reader.internal') }}</strong></span>
        <span class="booster-internal-preview">{{ preview || item.record.contentType || item.record.messageType || t('reader.noText') }}</span>
        <ChevronDown v-if="expanded" class="size-3.5" /><ChevronRight v-else class="size-3.5" />
      </button>
      <div v-if="expanded" class="booster-tool-expanded"><MarkdownContent :text="item.text || t('reader.noText')" /><button class="booster-record-meta-button" type="button" @click="rawOpen = true"><FileJson2 class="size-3.5" />{{ t('reader.raw') }}</button></div>
    </template>

    <ModalSurface v-if="rawOpen" :label="t('reader.raw')" wide @close="rawOpen = false">
      <header class="booster-record-modal-header"><div><strong>{{ t('reader.raw') }}</strong><span>{{ item.record.messageId }}</span></div><button class="booster-icon-button" type="button" :aria-label="t('common.close')" @click="rawOpen = false"><X class="size-4" /></button></header>
      <JsonViewer :value="item.record.raw" />
    </ModalSurface>

    <ModalSurface v-if="runOpen" :label="t('reader.runTitle')" wide @close="runOpen = false">
      <header class="booster-record-modal-header"><div><strong>{{ t('reader.runTitle') }}</strong><span>{{ toolName }} · {{ t('reader.readonlyRun') }}</span></div><button class="booster-icon-button" type="button" :aria-label="t('common.close')" @click="runOpen = false"><X class="size-4" /></button></header>
      <JsonViewer :value="runPayload" />
    </ModalSurface>
  </section>
</template>
