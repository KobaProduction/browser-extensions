<script setup lang="ts">
import Check from 'lucide-vue-next/dist/esm/icons/check.js'
import Clipboard from 'lucide-vue-next/dist/esm/icons/clipboard.js'
import ExternalLink from 'lucide-vue-next/dist/esm/icons/external-link.js'
import Globe2 from 'lucide-vue-next/dist/esm/icons/globe.js'
import Wrench from 'lucide-vue-next/dist/esm/icons/wrench.js'
import { computed, ref } from 'vue'
import FloatingInfoPopover from './FloatingInfoPopover.vue'
import JsonViewer from './JsonViewer.vue'
import { Button } from './components/ui/button'
import { translate } from './i18n'
import type { ToolCallViewModel } from './tool-inspector'

const props = defineProps<{ model: ToolCallViewModel; now?: number }>()
const copied = ref(false)
const t = (key: Parameters<typeof translate>[1]) => translate(props.model.locale, key)

function serverTime(value: number | null) {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}

function fullDate(value: number | null) {
  const time = serverTime(value)
  return time ? new Date(time).toLocaleString(props.model.locale) : null
}

function duration(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  const ms = Math.max(0, value)
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

const startedAt = computed(() => fullDate(props.model.tool.timestamp))
const finishedAt = computed(() => fullDate(props.model.tool.finishedAt))
const durationLabel = computed(() => {
  if (props.model.tool.durationMs !== null) return duration(props.model.tool.durationMs)
  const started = serverTime(props.model.tool.timestamp)
  if (!props.model.active || !started || !props.now) return null
  return duration(Math.max(0, props.now - started))
})
const isWebTool = computed(() =>
  /(?:^|\b)(web|browser|search)(?:\b|$)/i.test(
    [props.model.tool.provider, props.model.tool.action, props.model.tool.label].filter(Boolean).join(' '),
  ),
)

async function copyDiagnostics() {
  await navigator.clipboard.writeText(JSON.stringify(props.model, null, 2))
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1200)
}
</script>

<template>
  <FloatingInfoPopover
    mode="hover-click"
    :label="t('tool.inspect')"
    align="start"
    trigger-class="booster-tool-inspect-trigger"
  >
    <template #trigger><Wrench class="size-3.5" /></template>
    <template #default="{ pinned }">
      <div class="booster-tool-detail-popover" :lang="model.locale">
        <header>
          <img
            v-if="model.tool.iconUrl"
            :src="model.tool.iconUrl"
            alt=""
            class="booster-live-tool-icon"
          />
          <Globe2 v-else-if="isWebTool" class="size-4 shrink-0" />
          <Wrench v-else class="size-4 shrink-0" />
          <div class="min-w-0 flex-1">
            <strong>{{ model.tool.provider || model.tool.label }}</strong>
            <span v-if="model.tool.action">{{ model.tool.action }}</span>
          </div>
          <Button
            v-if="pinned"
            variant="ghost"
            size="icon-sm"
            :title="t('tool.copyDiagnostics')"
            @click.stop="copyDiagnostics"
          >
            <Check v-if="copied" class="size-3.5" />
            <Clipboard v-else class="size-3.5" />
          </Button>
        </header>

        <div class="booster-meta-lines">
          <template v-if="durationLabel">
            <strong class="booster-meta-label">{{ t('tool.duration') }}</strong>
            <span class="booster-meta-value">{{ durationLabel }}</span>
          </template>
          <template v-if="model.tool.provider">
            <strong class="booster-meta-label">{{ t('tool.provider') }}</strong>
            <span class="booster-meta-value">{{ model.tool.provider }}</span>
          </template>
          <template v-if="model.tool.action">
            <strong class="booster-meta-label">{{ t('tool.action') }}</strong>
            <span class="booster-meta-value">{{ model.tool.action }}</span>
          </template>
          <template v-if="pinned && startedAt">
            <strong class="booster-meta-label">{{ t('tool.startedAt') }}</strong>
            <span class="booster-meta-value">{{ startedAt }}</span>
          </template>
          <template v-if="pinned && finishedAt">
            <strong class="booster-meta-label">{{ t('tool.finishedAt') }}</strong>
            <span class="booster-meta-value">{{ finishedAt }}</span>
          </template>
          <template v-if="pinned && model.tool.recipient">
            <strong class="booster-meta-label">{{ t('tool.recipient') }}</strong>
            <span class="booster-meta-value">{{ model.tool.recipient }}</span>
          </template>
          <template v-if="pinned && model.tool.path">
            <strong class="booster-meta-label">{{ t('tool.path') }}</strong>
            <span class="booster-meta-value booster-tool-path">{{ model.tool.path }}</span>
          </template>
        </div>

        <a
          v-if="pinned && model.tool.link"
          class="booster-tool-link"
          :href="model.tool.link"
          target="_blank"
          rel="noreferrer"
          @click.stop
        >
          <ExternalLink class="size-3.5" />{{ t('tool.link') }}
        </a>

        <div v-if="pinned && model.tool.payload !== null" class="booster-tool-payload">
          <strong>{{ t('tool.clientPayload') }}</strong>
          <JsonViewer :value="model.tool.payload" />
        </div>

        <div v-if="pinned && model.tool.result !== null" class="booster-tool-payload">
          <strong>{{ t('tool.result') }}</strong>
          <JsonViewer :value="model.tool.result" />
        </div>

        <details
          v-if="pinned && (Object.keys(model.attributes).length || model.visibleText)"
          class="booster-tool-evidence"
        >
          <summary>{{ t('tool.domEvidence') }}</summary>
          <dl v-if="Object.keys(model.attributes).length" class="booster-tool-attributes">
            <template v-for="(value, key) in model.attributes" :key="key">
              <dt>{{ key }}</dt><dd>{{ value }}</dd>
            </template>
          </dl>
          <pre>{{ model.visibleText }}</pre>
        </details>
      </div>
    </template>
  </FloatingInfoPopover>
</template>
