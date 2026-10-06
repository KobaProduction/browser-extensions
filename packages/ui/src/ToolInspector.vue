<script setup lang="ts">
import Check from 'lucide-vue-next/dist/esm/icons/check.js'
import Clipboard from 'lucide-vue-next/dist/esm/icons/clipboard.js'
import Globe2 from 'lucide-vue-next/dist/esm/icons/globe.js'
import Wrench from 'lucide-vue-next/dist/esm/icons/wrench.js'
import { computed, ref } from 'vue'
import type { ToolCallViewModel } from './tool-inspector'
import FloatingInfoPopover from './FloatingInfoPopover.vue'
import JsonViewer from './JsonViewer.vue'
import { Button } from './components/ui/button'
import { translate } from './i18n'

const props = defineProps<{ model: ToolCallViewModel }>()
const copied = ref(false)
const t = (key: Parameters<typeof translate>[1]) => translate(props.model.locale, key)

function serverTime(value: number | null) {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}

const timestampValue = computed(() => serverTime(props.model.tool.timestamp))
const timestamp = computed(() =>
  timestampValue.value ? new Date(timestampValue.value).toLocaleString(props.model.locale) : null,
)
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
  <FloatingInfoPopover mode="click" :label="t('tool.inspect')" align="start" trigger-class="booster-tool-inspect-trigger">
    <template #trigger><Wrench class="size-3.5" /></template>
    <div class="booster-tool-detail-popover" :lang="model.locale">
      <header>
        <img v-if="model.tool.iconUrl" :src="model.tool.iconUrl" alt="" class="booster-live-tool-icon" />
        <Globe2 v-else-if="isWebTool" class="size-4 shrink-0" />
        <Wrench v-else class="size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <strong>{{ model.tool.provider || model.tool.label }}</strong>
          <span v-if="model.tool.action">{{ model.tool.action }}</span>
        </div>
        <Button variant="ghost" size="icon-sm" :title="t('tool.copyDiagnostics')" @click.stop="copyDiagnostics">
          <Check v-if="copied" class="size-3.5" />
          <Clipboard v-else class="size-3.5" />
        </Button>
      </header>

      <div class="booster-meta-lines">
        <template v-if="timestamp">
          <strong class="booster-meta-label">{{ t('tool.calledAt') }}</strong><span class="booster-meta-value">{{ timestamp }}</span>
        </template>
        <template v-if="model.tool.provider">
          <strong class="booster-meta-label">{{ t('tool.provider') }}</strong><span class="booster-meta-value">{{ model.tool.provider }}</span>
        </template>
        <template v-if="model.tool.action">
          <strong class="booster-meta-label">{{ t('tool.action') }}</strong><span class="booster-meta-value">{{ model.tool.action }}</span>
        </template>
      </div>

      <div v-if="model.tool.payload !== null" class="booster-tool-payload">
        <strong>{{ t('tool.clientPayload') }}</strong>
        <JsonViewer :value="model.tool.payload" />
      </div>

      <details v-if="Object.keys(model.attributes).length || model.visibleText" class="booster-tool-evidence">
        <summary>{{ t('tool.domEvidence') }}</summary>
        <dl v-if="Object.keys(model.attributes).length" class="booster-tool-attributes">
          <template v-for="(value, key) in model.attributes" :key="key">
            <dt>{{ key }}</dt><dd>{{ value }}</dd>
          </template>
        </dl>
        <pre>{{ model.visibleText }}</pre>
      </details>
    </div>
  </FloatingInfoPopover>
</template>
