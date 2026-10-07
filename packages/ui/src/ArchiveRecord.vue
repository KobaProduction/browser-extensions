<script setup lang="ts">
import type { ArchiveItemView } from '@chatgpt-booster/core'
import Brain from 'lucide-vue-next/dist/esm/icons/brain.js'
import ChevronDown from 'lucide-vue-next/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-vue-next/dist/esm/icons/chevron-right.js'
import Code2 from 'lucide-vue-next/dist/esm/icons/code-xml.js'
import ExternalLink from 'lucide-vue-next/dist/esm/icons/external-link.js'
import FileJson2 from 'lucide-vue-next/dist/esm/icons/file-json-2.js'
import GitBranch from 'lucide-vue-next/dist/esm/icons/git-branch.js'
import Github from 'lucide-vue-next/dist/esm/icons/github.js'
import Globe2 from 'lucide-vue-next/dist/esm/icons/earth.js'
import ImageIcon from 'lucide-vue-next/dist/esm/icons/image.js'
import Search from 'lucide-vue-next/dist/esm/icons/search.js'
import TerminalSquare from 'lucide-vue-next/dist/esm/icons/square-terminal.js'
import Wrench from 'lucide-vue-next/dist/esm/icons/wrench.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, ref } from 'vue'
import FloatingInfoPopover from './FloatingInfoPopover.vue'
import JsonViewer from './JsonViewer.vue'
import MarkdownContent from './MarkdownContent.vue'
import ModalSurface from './ModalSurface.vue'
import RecordMetaBadges from './RecordMetaBadges.vue'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import { omitRepeatedRecordHeading, parseArchiveStructuredText } from './archive-presentation'

const props = withDefaults(
  defineProps<{ item: ArchiveItemView; locale: SupportedLocale; expandReasoning?: boolean }>(),
  { expandReasoning: false },
)
const expanded = ref(false)
const rawOpen = ref(false)
const t = (key: TranslationKey) => translate(props.locale, key)

const tool = computed(() => props.item.tool)
const toolName = computed(() => tool.value?.label ?? t(('reader.' + props.item.kind) as TranslationKey))
const toolPayload = computed(() => tool.value?.payload ?? null)
const structuredText = computed(() => parseArchiveStructuredText(props.item.text))
const toolDetails = computed(() => toolPayload.value ?? tool.value?.result ?? structuredText.value)
const displayText = computed(() => {
  const heading =
    props.item.kind === 'tool_call' || props.item.kind === 'tool_result'
      ? toolName.value
      : t(('reader.' + props.item.kind) as TranslationKey)
  const text = omitRepeatedRecordHeading(props.item.text, heading)
  // A tool payload already has a dedicated structured inspector; do not repeat raw JSON as prose.
  return (props.item.kind === 'tool_call' || props.item.kind === 'tool_result') &&
    parseArchiveStructuredText(text) !== null
    ? ''
    : text
})
const hasText = computed(() => {
  const value = displayText.value.trim()
  if (!value) return false
  return !/^(?:the output of this plugin was (?:redacted|omitted)|output (?:redacted|omitted))\.?$/i.test(
    value,
  )
})
const preview = computed(() => {
  const text = displayText.value.trim()
  return text.length > 220 ? text.slice(0, 220).trimEnd() + '…' : text
})
const isReasoningExpanded = computed(() => props.expandReasoning || expanded.value)

const toolLink = computed(() => tool.value?.link ?? null)
const toolIcon = computed(() => tool.value?.iconUrl ?? null)
const toolRecipient = computed(() => tool.value?.recipient ?? props.item.record.recipient ?? null)
const hasToolDetails = computed(() => hasText.value || toolDetails.value !== null)
const toolGlyph = computed(() => {
  const key = (tool.value?.iconKey ?? tool.value?.label ?? '').toLowerCase()
  if (key.includes('globe') || key.includes('web')) return Globe2
  if (key.includes('github')) return Github
  if (key.includes('search')) return Search
  if (key.includes('terminal') || key.includes('shell')) return TerminalSquare
  if (key.includes('image')) return ImageIcon
  if (key.includes('git')) return GitBranch
  return Wrench
})
const reasoningInfo = computed(() =>
  [
    props.item.metadata.model && t('reader.model') + ': ' + props.item.metadata.model,
    props.item.metadata.thinking && t('reader.thinking') + ': ' + props.item.metadata.thinking,
  ]
    .filter(Boolean)
    .join('\n'),
)
</script>

<template>
  <section class="booster-record" :class="'booster-record-' + item.kind">
    <template v-if="item.kind === 'user' || item.kind === 'answer'">
      <header class="booster-record-header">
        <strong>{{ t(('reader.' + item.kind) as TranslationKey) }}</strong>
        <span v-if="item.metadata.edited" class="booster-record-edited">{{ t('reader.editedShort') }}</span>
        <span class="booster-record-header-tools">
          <RecordMetaBadges
            :metadata="item.metadata"
            :locale="locale"
            :show-model="item.kind === 'answer'"
          />
          <button
            class="booster-record-icon-button"
            type="button"
            :title="t('reader.raw')"
            :aria-label="t('reader.raw')"
            @click="rawOpen = true"
          ><FileJson2 class="size-3.5" /></button>
        </span>
      </header>
      <MarkdownContent :text="item.text || t('reader.noText')" />
    </template>

    <template v-else-if="item.kind === 'reasoning'">
      <header class="booster-record-header booster-record-internal-header">
        <span class="booster-record-kind">
          <FloatingInfoPopover
            v-if="reasoningInfo"
            :label="reasoningInfo"
            align="start"
          >
            <template #trigger><Brain class="size-4" /></template>
            <div class="booster-meta-lines">
              <template v-if="item.metadata.model">
                <strong class="booster-meta-label">{{ t('reader.model') }}</strong><span class="booster-meta-value">{{ item.metadata.model }}</span>
              </template>
              <template v-if="item.metadata.thinking">
                <strong class="booster-meta-label">{{ t('reader.thinking') }}</strong><span class="booster-meta-value">{{ item.metadata.thinking }}</span>
              </template>
            </div>
          </FloatingInfoPopover>
          <Brain v-else class="size-4" />
          <strong>{{ t('reader.reasoning') }}</strong>
        </span>
        <span class="booster-record-header-tools">
          <button
            class="booster-record-icon-button"
            type="button"
            :title="t('reader.raw')"
            :aria-label="t('reader.raw')"
            @click="rawOpen = true"
          ><FileJson2 class="size-3.5" /></button>
          <button
            v-if="hasText"
            class="booster-record-expand"
            type="button"
            @click="expanded = !expanded"
          >
            <ChevronDown v-if="isReasoningExpanded" class="size-3.5" />
            <ChevronRight v-else class="size-3.5" />
            {{ t(isReasoningExpanded ? 'reader.collapse' : 'reader.expand') }}
          </button>
        </span>
      </header>
      <div v-if="hasText" class="booster-reasoning-preview" :class="{ expanded: isReasoningExpanded }">
        <MarkdownContent :text="displayText" />
      </div>
    </template>

    <template v-else-if="item.kind === 'tool_call' || item.kind === 'tool_result'">
      <div
        class="booster-tool-row"
        :class="{ 'is-clickable': hasToolDetails }"
        @click="hasToolDetails && (expanded = !expanded)"
      >
        <img
          v-if="toolIcon"
          class="booster-tool-icon"
          :src="toolIcon"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
        />
        <span v-else class="booster-tool-icon booster-tool-icon-fallback">
          <component :is="toolGlyph" class="size-4" />
        </span>
        <div class="booster-tool-copy">
          <strong :title="toolName">{{ toolName }}</strong>
          <span>
            {{ t(('reader.' + item.kind) as TranslationKey) }}
            <template v-if="toolRecipient && toolRecipient !== 'all' && toolRecipient !== 'functions.exec'">
              · {{ toolRecipient }}
            </template>
          </span>
          <p v-if="preview && !expanded">{{ preview }}</p>
        </div>
        <div class="booster-tool-actions" @click.stop>
          <RecordMetaBadges :metadata="item.metadata" :locale="locale" />
          <a
            v-if="toolLink"
            class="booster-tool-action"
            :href="toolLink"
            target="_blank"
            rel="noreferrer noopener"
            :title="t('reader.openTool') + ': ' + toolLink"
          ><ExternalLink class="size-3.5" /></a>
          <button
            v-if="hasToolDetails"
            type="button"
            class="booster-tool-action"
            :title="t(expanded ? 'reader.hide' : 'reader.show')"
            @click="expanded = !expanded"
          ><Code2 class="size-3.5" /></button>
          <button
            type="button"
            class="booster-tool-action"
            :title="t('reader.raw')"
            @click="rawOpen = true"
          ><FileJson2 class="size-3.5" /></button>
        </div>
      </div>
      <div v-if="expanded && hasToolDetails" class="booster-tool-expanded">
        <MarkdownContent v-if="hasText" :text="displayText" />
        <JsonViewer v-else :value="toolDetails" />
      </div>
    </template>

    <template v-else>
      <button
        class="booster-internal-row"
        type="button"
        :class="{ disabled: !hasText }"
        :disabled="!hasText"
        @click="expanded = !expanded"
      >
        <span><Code2 class="size-4" /><strong>{{ t('reader.internal') }}</strong></span>
        <span class="booster-internal-preview">
          {{ expanded ? '' : (preview || item.record.contentType || item.record.messageType || t('reader.metadataOnly')) }}
        </span>
        <ChevronDown v-if="expanded && hasText" class="size-3.5" />
        <ChevronRight v-else-if="hasText" class="size-3.5" />
      </button>
      <div v-if="expanded && hasText" class="booster-tool-expanded">
        <MarkdownContent :text="displayText" />
      </div>
      <button
        class="booster-record-icon-button booster-record-raw-corner"
        type="button"
        :title="t('reader.raw')"
        :aria-label="t('reader.raw')"
        @click="rawOpen = true"
      ><FileJson2 class="size-3.5" /></button>
    </template>

    <ModalSurface v-if="rawOpen" :label="t('reader.raw')" wide @close="rawOpen = false">
      <div class="booster-json-modal">
        <header class="booster-record-modal-header">
          <div><strong>{{ t('reader.raw') }}</strong><span>{{ item.record.messageId }}</span></div>
          <button class="booster-icon-button" type="button" :aria-label="t('common.close')" @click="rawOpen = false"><X class="size-4" /></button>
        </header>
        <JsonViewer :value="item.record.raw" />
      </div>
    </ModalSurface>
  </section>
</template>
