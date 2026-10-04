<script setup lang="ts">
import type { ArchiveItemView } from '@chatgpt-booster/core'
import {
  Brain,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  FileJson2,
  GitBranch,
  Github,
  Globe2,
  Image as ImageIcon,
  Search,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-vue-next'
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
const t = (key: TranslationKey) => translate(props.locale, key)

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? null
}
function safeHttpUrl(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
    } catch {}
  }
  return null
}
function serverTime(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}
function fullDate(value: number | null | undefined) {
  const time = serverTime(value)
  return time ? new Date(time).toLocaleString(props.locale) : null
}
function shortTime(value: number | null | undefined) {
  const time = serverTime(value)
  return time
    ? new Date(time).toLocaleTimeString(props.locale, { hour: '2-digit', minute: '2-digit' })
    : null
}
function cleanToolSegment(value: string) {
  return value
    .replace(/^mcp__/, '')
    .replace(/^github_(?:agent|reviewer)_/, '')
    .replace(/^gitlab_/, '')
    .replace(/^browser_/, '')
    .replace(/^devtools_/, '')
    .replaceAll('__', ' · ')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function nestedToolFromPayload(value: unknown): string | null {
  const seen = new Set<unknown>()
  const walk = (input: unknown, depth: number): string | null => {
    if (depth > 5 || seen.has(input)) return null
    if (typeof input === 'string') {
      const direct = input.match(/\btools\.([A-Za-z0-9_]+)\s*\(/)?.[1]
      if (direct) return direct
      const mcp = input.match(/\b(mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+)\b/)?.[1]
      return mcp ?? null
    }
    if (!input || typeof input !== 'object') return null
    seen.add(input)
    if (Array.isArray(input)) {
      for (const item of input) {
        const nested = walk(item, depth + 1)
        if (nested) return nested
      }
      return null
    }
    for (const item of Object.values(input as Record<string, unknown>)) {
      const nested = walk(item, depth + 1)
      if (nested) return nested
    }
    return null
  }
  return walk(value, 0)
}
function humanToolName(value: string) {
  if (value.startsWith('mcp__')) {
    const raw = value.slice('mcp__'.length)
    const split = raw.indexOf('__')
    if (split > 0) {
      const provider = raw.slice(0, split).replaceAll('_', ' ')
      const action = cleanToolSegment(raw.slice(split + 2))
      return `${provider} · ${action}`
    }
  }
  const parts = value.split(/[./:]/).filter(Boolean)
  if (parts.length > 1) return `${parts.slice(0, -1).join(' · ')} · ${cleanToolSegment(parts.at(-1) ?? value)}`
  return cleanToolSegment(value) || value
}
const metadata = computed(() => object(props.item.record.raw.metadata))
const recipient = computed(() => props.item.record.recipient?.trim() || null)
const toolPayload = computed(() =>
  metadata.value?.arguments ??
  metadata.value?.args ??
  metadata.value?.input ??
  props.item.record.raw.arguments ??
  props.item.record.raw.args ??
  props.item.record.raw.input ??
  null,
)
const rawToolName = computed(() =>
  firstString(
    metadata.value?.tool_title,
    metadata.value?.tool_name,
    metadata.value?.connector_name,
    metadata.value?.app_name,
    metadata.value?.name,
    props.item.record.authorName,
    recipient.value && recipient.value !== 'all' ? recipient.value : null,
    'tool',
  ),
)
const nestedToolName = computed(() => nestedToolFromPayload(toolPayload.value ?? props.item.record.raw))
const effectiveToolName = computed(() => {
  const raw = nestedToolName.value ?? rawToolName.value ?? 'tool'
  return humanToolName(raw)
})
const toolName = computed(() => effectiveToolName.value)
const toolLink = computed(() =>
  safeHttpUrl(
    metadata.value?.tool_url,
    metadata.value?.connector_url,
    metadata.value?.app_url,
    metadata.value?.source_url,
  ),
)

function iconUrl(value: unknown, depth = 0): string | null {
  if (depth > 3) return null
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value
    try {
      const url = new URL(value)
      const host = url.hostname.toLowerCase()
      const trustedOpenAiHost =
        host === 'chatgpt.com' ||
        host.endsWith('.chatgpt.com') ||
        host === 'openai.com' ||
        host.endsWith('.openai.com') ||
        host === 'oaistatic.com' ||
        host.endsWith('.oaistatic.com')
      const observedFaviconService =
        host === 'www.google.com' && url.pathname === '/s2/favicons'
      if (url.protocol === 'https:' && (trustedOpenAiHost || observedFaviconService)) return url.href
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
  const key = toolIconKey.value || rawToolName.value?.toLowerCase() || ''
  if (key.includes('globe') || key.includes('web')) return Globe2
  if (key.includes('github')) return Github
  if (key.includes('search')) return Search
  if (key.includes('terminal') || key.includes('shell')) return TerminalSquare
  if (key.includes('image')) return ImageIcon
  if (key.includes('git')) return GitBranch
  return Wrench
})
const hasText = computed(() => {
  const value = props.item.text.trim()
  if (!value) return false
  return !/^(?:the output of this plugin was (?:redacted|omitted)|output (?:redacted|omitted))\.?$/i.test(value)
})
const hasToolDetails = computed(() => hasText.value || toolPayload.value !== null)
const isReasoningExpanded = computed(() => props.expandReasoning || expanded.value)
const preview = computed(() => {
  const text = props.item.text.trim()
  return text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text
})
const created = computed(() => fullDate(props.item.record.createTime ?? props.item.record.firstSeenAt))
const updated = computed(() => fullDate(props.item.record.updateTime))
const edited = computed(() => {
  const raw = props.item.record.raw
  const meta = metadata.value ?? {}
  const numericCount = typeof meta.edit_count === 'number' ? meta.edit_count : 0
  return Boolean(
    meta.edited === true ||
      meta.is_edited === true ||
      meta.was_edited === true ||
      meta.user_edited === true ||
      numericCount > 0 ||
      firstString(meta.original_message_id, meta.edit_source, raw.original_message_id),
  )
})
const timeTitle = computed(() => {
  const parts = created.value ? [`${t('reader.sentAt')}: ${created.value}`] : []
  if (edited.value && updated.value) parts.push(`${t('reader.editedAt')}: ${updated.value}`)
  return parts.join('\n') || t('reader.timeUnknown')
})
const thinkingTitle = computed(() => {
  const model =
    props.item.record.resolvedModelSlug ||
    props.item.record.modelSlug ||
    firstString(metadata.value?.model_slug, metadata.value?.resolved_model_slug)
  const effort = firstString(
    metadata.value?.reasoning_effort,
    metadata.value?.thinking_level,
    metadata.value?.reasoning_status,
    metadata.value?.reasoning_recap_type,
  )
  return [model && `${t('reader.model')}: ${model}`, effort && `${t('reader.thinking')}: ${effort}`]
    .filter(Boolean)
    .join('\n')
})
</script>

<template>
  <section class="booster-record" :class="`booster-record-${item.kind}`">
    <template v-if="item.kind === 'user' || item.kind === 'answer'">
      <header class="booster-record-header">
        <strong>{{ t(`reader.${item.kind}`) }}</strong>
        <time v-if="shortTime(item.record.createTime ?? item.record.firstSeenAt)" class="booster-record-time-text" :title="timeTitle">{{ shortTime(item.record.createTime ?? item.record.firstSeenAt) }}</time>
        <span v-if="edited" class="booster-record-edited">{{ t('reader.editedShort') }}</span>
        <span class="booster-record-header-tools">
          <span class="booster-record-info" :title="timeTitle"><Clock3 class="size-3.5" /></span>
          <span v-if="item.kind === 'answer' && thinkingTitle" class="booster-record-info" :title="thinkingTitle"><BrainCircuit class="size-3.5" /></span>
          <button class="booster-record-icon-button" type="button" :title="t('reader.raw')" :aria-label="t('reader.raw')" @click="rawOpen = true"><FileJson2 class="size-3.5" /></button>
        </span>
      </header>
      <MarkdownContent :text="item.text || t('reader.noText')" />
    </template>

    <template v-else-if="item.kind === 'reasoning'">
      <header class="booster-record-header booster-record-internal-header">
        <span class="booster-record-kind"><Brain class="size-4" /><strong>{{ t('reader.reasoning') }}</strong></span>
        <span class="booster-record-header-tools">
          <span v-if="thinkingTitle" class="booster-record-info" :title="thinkingTitle"><BrainCircuit class="size-3.5" /></span>
          <button class="booster-record-icon-button" type="button" :title="t('reader.raw')" :aria-label="t('reader.raw')" @click="rawOpen = true"><FileJson2 class="size-3.5" /></button>
          <button v-if="hasText" class="booster-record-expand" type="button" @click="expanded = !expanded">
            <ChevronDown v-if="isReasoningExpanded" class="size-3.5" /><ChevronRight v-else class="size-3.5" />
            {{ t(isReasoningExpanded ? 'reader.collapse' : 'reader.expand') }}
          </button>
        </span>
      </header>
      <div v-if="hasText" class="booster-reasoning-preview" :class="{ expanded: isReasoningExpanded }">
        <MarkdownContent :text="item.text" />
      </div>
    </template>

    <template v-else-if="item.kind === 'tool_call' || item.kind === 'tool_result'">
      <div class="booster-tool-row" :class="{ 'is-clickable': hasToolDetails }" @click="hasToolDetails && (expanded = !expanded)">
        <img v-if="toolIcon" class="booster-tool-icon" :src="toolIcon" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span v-else class="booster-tool-icon booster-tool-icon-fallback"><component :is="toolGlyph" class="size-4" /></span>
        <div class="booster-tool-copy">
          <strong :title="toolName">{{ toolName }}</strong>
          <span>{{ t(`reader.${item.kind}`) }}<template v-if="recipient && recipient !== rawToolName && recipient !== 'all' && recipient !== 'functions.exec'"> · {{ recipient }}</template></span>
          <p v-if="preview">{{ preview }}</p>
        </div>
        <div class="booster-tool-actions" @click.stop>
          <span v-if="thinkingTitle" class="booster-record-info" :title="thinkingTitle"><BrainCircuit class="size-3.5" /></span>
          <a v-if="toolLink" class="booster-tool-action" :href="toolLink" target="_blank" rel="noreferrer noopener" :title="`${t('reader.openTool')}: ${toolLink}`"><ExternalLink class="size-3.5" /></a>
          <button v-if="hasToolDetails" type="button" class="booster-tool-action" :title="t(expanded ? 'reader.hide' : 'reader.show')" @click="expanded = !expanded"><Code2 class="size-3.5" /></button>
          <button type="button" class="booster-tool-action" :title="t('reader.raw')" @click="rawOpen = true"><FileJson2 class="size-3.5" /></button>
        </div>
      </div>
      <div v-if="expanded && hasToolDetails" class="booster-tool-expanded"><MarkdownContent v-if="hasText" :text="item.text" /><JsonViewer v-else :value="toolPayload" /></div>
    </template>

    <template v-else>
      <button class="booster-internal-row" type="button" :class="{ disabled: !hasText }" :disabled="!hasText" @click="expanded = !expanded">
        <span><Code2 class="size-4" /><strong>{{ t('reader.internal') }}</strong></span>
        <span class="booster-internal-preview">{{ preview || item.record.contentType || item.record.messageType || t('reader.metadataOnly') }}</span>
        <ChevronDown v-if="expanded && hasText" class="size-3.5" /><ChevronRight v-else-if="hasText" class="size-3.5" />
      </button>
      <div v-if="expanded && hasText" class="booster-tool-expanded"><MarkdownContent :text="item.text" /></div>
      <button class="booster-record-icon-button booster-record-raw-corner" type="button" :title="t('reader.raw')" :aria-label="t('reader.raw')" @click="rawOpen = true"><FileJson2 class="size-3.5" /></button>
    </template>

    <ModalSurface v-if="rawOpen" :label="t('reader.raw')" wide @close="rawOpen = false">
      <div class="booster-json-modal">
        <header class="booster-record-modal-header"><div><strong>{{ t('reader.raw') }}</strong><span>{{ item.record.messageId }}</span></div><button class="booster-icon-button" type="button" :aria-label="t('common.close')" @click="rawOpen = false"><X class="size-4" /></button></header>
        <JsonViewer :value="item.record.raw" />
      </div>
    </ModalSurface>
  </section>
</template>
