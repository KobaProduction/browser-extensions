<script setup lang="ts">
import { Check, ChevronDown, Clipboard, Clock3, Wrench } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { ToolCallViewModel } from './tool-inspector'
import FloatingInfoPopover from './FloatingInfoPopover.vue'
import JsonViewer from './JsonViewer.vue'
import { Button } from './components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import { translate } from './i18n'

const props = defineProps<{ model: ToolCallViewModel }>()
const copied = ref(false)
const t = (key: Parameters<typeof translate>[1]) => translate(props.model.locale, key)

function serverTime(value: number | null) {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}
const timestamp = computed(() => {
  const value = serverTime(props.model.tool.timestamp)
  return value ? new Date(value).toLocaleString(props.model.locale) : null
})

async function copyDiagnostics() {
  await navigator.clipboard.writeText(JSON.stringify(props.model, null, 2))
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1200)
}
</script>

<template>
  <Collapsible class="booster-tool-inspector" :lang="model.locale">
    <div class="booster-live-tool-row">
      <Wrench class="size-3.5 shrink-0" />
      <div class="booster-live-tool-copy">
        <strong class="booster-live-tool-name">{{ model.tool.provider || model.tool.label }}</strong>
        <span v-if="model.tool.action" class="booster-live-tool-action-name">{{ model.tool.action }}</span>
      </div>

      <FloatingInfoPopover
        v-if="timestamp"
        :aria-label="t('reader.sentAt') + ': ' + timestamp"
      >
        <template #trigger><Clock3 class="size-3.5" /></template>
        <div class="booster-meta-lines">
          <strong class="booster-meta-label">{{ t('reader.sentAt') }}</strong><span class="booster-meta-value">{{ timestamp }}</span>
          <template v-if="model.tool.provider">
            <strong class="booster-meta-label">{{ t('tool.provider') }}</strong><span class="booster-meta-value">{{ model.tool.provider }}</span>
          </template>
          <template v-if="model.tool.action">
            <strong class="booster-meta-label">{{ t('tool.action') }}</strong><span class="booster-meta-value">{{ model.tool.action }}</span>
          </template>
        </div>
      </FloatingInfoPopover>

      <CollapsibleTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
        >
          {{ t('tool.details') }}
          <ChevronDown class="size-3.5 opacity-60" />
        </Button>
      </CollapsibleTrigger>
    </div>

    <CollapsibleContent>
      <section class="booster-live-tool-details">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-xs font-semibold">{{ model.tool.label }}</div>
            <div class="mt-1 text-[11px] text-muted-foreground">
              {{ t('tool.confidence') }} {{ model.score }} · {{ model.signals.join(', ') }}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            :title="t('tool.copyDiagnostics')"
            @click="copyDiagnostics"
          >
            <Check v-if="copied" class="size-3.5" />
            <Clipboard v-else class="size-3.5" />
          </Button>
        </div>

        <div class="mt-3 grid gap-3">
          <div>
            <div class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t('tool.clientPayload') }}
            </div>
            <JsonViewer v-if="model.tool.payload !== null" :value="model.tool.payload" />
            <p v-else class="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              {{ t('tool.noPayload') }}
            </p>
          </div>

          <details v-if="Object.keys(model.attributes).length || model.visibleText" class="text-[11px]">
            <summary class="cursor-pointer select-none font-medium text-muted-foreground">
              {{ t('tool.domEvidence') }}
            </summary>
            <dl v-if="Object.keys(model.attributes).length" class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <template v-for="(value, key) in model.attributes" :key="key">
                <dt class="font-mono text-muted-foreground">{{ key }}</dt>
                <dd class="break-all font-mono">{{ value }}</dd>
              </template>
            </dl>
            <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-4">{{ model.visibleText }}</pre>
          </details>
        </div>
      </section>
    </CollapsibleContent>
  </Collapsible>
</template>
