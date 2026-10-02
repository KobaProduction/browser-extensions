<script setup lang="ts">
import type { BoosterSettings, SettingsAdapter } from '@chatgpt-booster/core'
import { Check, ChevronRight, RotateCcw, Settings2, Wrench, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'

const props = defineProps<{
  settingsAdapter: SettingsAdapter
  target: 'extension' | 'userscript'
}>()

const open = ref(false)
const ready = ref(false)
const saving = ref(false)
const saved = ref(false)
const settings = ref<BoosterSettings>()
let unsubscribe: (() => void) | undefined
let savedTimer: number | undefined

const targetLabel = computed(() => (props.target === 'userscript' ? 'Tampermonkey' : 'Extension'))

onMounted(async () => {
  settings.value = await props.settingsAdapter.get()
  unsubscribe = props.settingsAdapter.subscribe((next) => {
    settings.value = structuredClone(next)
  })
  ready.value = true
})

onBeforeUnmount(() => {
  unsubscribe?.()
  if (savedTimer) window.clearTimeout(savedTimer)
})

async function persist() {
  if (!settings.value) return

  saving.value = true
  try {
    await props.settingsAdapter.set(structuredClone(settings.value))
    saved.value = true
    if (savedTimer) window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => {
      saved.value = false
    }, 1200)
  } finally {
    saving.value = false
  }
}

async function reset() {
  settings.value = {
    enabled: true,
    features: {
      toolInspector: true,
    },
  }
  await persist()
}
</script>

<template>
  <div class="booster-shell">
    <div v-if="open" class="booster-control-center">
      <header class="booster-control-header">
        <div>
          <div class="flex items-center gap-2">
            <strong>ChatGPT Booster</strong>
            <Badge variant="outline">{{ targetLabel }}</Badge>
          </div>
          <p>Control Center</p>
        </div>
        <Button variant="ghost" size="icon" class="size-8" title="Close" @click="open = false">
          <X class="size-4" />
        </Button>
      </header>

      <div v-if="!ready || !settings" class="booster-loading">Loading settings…</div>

      <div v-else class="booster-control-body">
        <section class="booster-setting-card">
          <div class="booster-setting-copy">
            <div class="flex items-center gap-2">
              <Settings2 class="size-4" />
              <b>Booster</b>
            </div>
            <span>Master switch for page enhancements. The control center stays available.</span>
          </div>
          <button
            type="button"
            class="booster-switch"
            :class="{ 'booster-switch-on': settings.enabled }"
            :aria-pressed="settings.enabled"
            @click="settings.enabled = !settings.enabled; persist()"
          >
            <span />
          </button>
        </section>

        <div class="booster-section-label">Modules</div>

        <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
          <div class="booster-setting-copy">
            <div class="flex items-center gap-2">
              <Wrench class="size-4" />
              <b>Tool Inspector</b>
              <Badge :variant="settings.features.toolInspector && settings.enabled ? 'default' : 'secondary'">
                {{ settings.features.toolInspector && settings.enabled ? 'On' : 'Off' }}
              </Badge>
            </div>
            <span>
              Adds an Inspect control beside detected MCP/tool activity and exposes client-visible
              payloads, timestamps and DOM diagnostics.
            </span>
          </div>
          <button
            type="button"
            class="booster-switch"
            :class="{ 'booster-switch-on': settings.features.toolInspector }"
            :disabled="!settings.enabled"
            :aria-pressed="settings.features.toolInspector"
            @click="settings.features.toolInspector = !settings.features.toolInspector; persist()"
          >
            <span />
          </button>
        </section>

        <section class="booster-info-card">
          <div class="flex items-center gap-2 font-medium">
            <ChevronRight class="size-4" />
            Current behavior
          </div>
          <ul>
            <li>Runs only on chatgpt.com.</li>
            <li>Settings are stored locally in the browser.</li>
            <li>No chat content is sent by Booster.</li>
            <li>Tool details are shown only when the ChatGPT client exposes them.</li>
          </ul>
        </section>

        <footer class="booster-control-footer">
          <Button variant="ghost" size="sm" class="gap-1.5" @click="reset">
            <RotateCcw class="size-3.5" />
            Reset
          </Button>
          <span class="booster-save-state">
            <Check v-if="saved" class="size-3.5" />
            {{ saving ? 'Saving…' : saved ? 'Saved' : 'Settings apply live' }}
          </span>
        </footer>
      </div>
    </div>

    <button class="booster-button" type="button" title="ChatGPT Booster" @click="open = !open">
      B
    </button>
  </div>
</template>
