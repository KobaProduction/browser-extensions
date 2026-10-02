<script setup lang="ts">
import { Check, ChevronDown, Clipboard, Clock3, Wrench } from 'lucide-vue-next'
import { ref } from 'vue'
import type { ToolCallViewModel } from './tool-inspector'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import { translate } from './i18n'

const props = defineProps<{ model: ToolCallViewModel }>()
const copied = ref(false)
const t = (key: Parameters<typeof translate>[1]) => translate(props.model.locale, key)

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
    <div class="flex items-center gap-1.5 py-1">
      <CollapsibleTrigger as-child>
        <Button variant="ghost" size="sm" class="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground">
          <Wrench class="size-3.5" />
          {{ t('tool.inspect') }}
          <Badge variant="outline" class="ml-0.5 uppercase">{{ model.kind }}</Badge>
          <ChevronDown class="size-3.5 opacity-60" />
        </Button>
      </CollapsibleTrigger>

      <span v-if="model.timestamp" class="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock3 class="size-3" />
        {{ model.timestamp }}
      </span>
    </div>

    <CollapsibleContent>
      <section class="mt-1 w-full max-w-3xl rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-xs font-semibold">{{ model.label }}</div>
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
            <div v-if="model.structuredPayloads.length" class="grid gap-2">
              <pre
                v-for="(payload, index) in model.structuredPayloads"
                :key="index"
                class="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-4 text-foreground"
              >{{ payload }}</pre>
            </div>
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
