<script setup lang="ts">
import {
  EMPTY_TRANSPORT_COUNTERS,
  type BoosterSettings,
  type DiagnosticsAdapter,
  type LanguagePreference,
  type SecretAdapter,
  type SettingsAdapter,
  type TransportCounters,
} from '@chatgpt-booster/core'
import { Activity, Check, Languages, Radio, Settings2, ShieldCheck, Wrench, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { resolveLocale, translate } from './i18n'

const props = withDefaults(
  defineProps<{
    settingsAdapter: SettingsAdapter
    diagnosticsAdapter?: DiagnosticsAdapter | undefined
    secretAdapter?: SecretAdapter | undefined
    target: 'extension' | 'userscript'
    showClose?: boolean
  }>(),
  { showClose: false },
)

const emit = defineEmits<{ close: [] }>()
const ready = ref(false)
const saving = ref(false)
const saved = ref(false)
const tokenDraft = ref('')
const tokenConfigured = ref(false)
const counters = ref<TransportCounters>({ ...EMPTY_TRANSPORT_COUNTERS })
const settings = ref<BoosterSettings>()
let unsubscribe: (() => void) | undefined
let unsubscribeDiagnostics: (() => void) | undefined
let savedTimer: number | undefined

const locale = computed(() => resolveLocale(settings.value?.language ?? 'auto'))
const t = (key: Parameters<typeof translate>[1]) => translate(locale.value, key)
const targetLabel = computed(() => (props.target === 'userscript' ? 'Tampermonkey' : 'Extension'))

onMounted(async () => {
  settings.value = await props.settingsAdapter.get()
  unsubscribe = props.settingsAdapter.subscribe((next) => {
    settings.value = structuredClone(next)
  })
  if (props.diagnosticsAdapter) {
    counters.value = props.diagnosticsAdapter.getTransportCounters()
    unsubscribeDiagnostics = props.diagnosticsAdapter.subscribeTransport((next) => {
      counters.value = next
    })
  }
  if (props.secretAdapter) tokenConfigured.value = Boolean(await props.secretAdapter.getTelemetryToken())
  ready.value = true
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeDiagnostics?.()
  if (savedTimer) window.clearTimeout(savedTimer)
})

async function persist() {
  if (!settings.value) return
  saving.value = true
  try {
    await props.settingsAdapter.set(structuredClone(settings.value))
    saved.value = true
    if (savedTimer) window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => (saved.value = false), 1200)
  } finally {
    saving.value = false
  }
}

async function setLanguage(event: Event) {
  if (!settings.value) return
  settings.value.language = (event.target as HTMLSelectElement).value as LanguagePreference
  await persist()
}

async function saveToken() {
  if (!props.secretAdapter) return
  await props.secretAdapter.setTelemetryToken(tokenDraft.value.trim())
  tokenConfigured.value = Boolean(tokenDraft.value.trim())
  tokenDraft.value = ''
  saved.value = true
}
</script>

<template>
  <section class="booster-control-center" :lang="locale">
    <header class="booster-control-header">
      <div>
        <div class="flex items-center gap-2">
          <strong>{{ t('control.title') }}</strong>
          <Badge variant="outline">{{ targetLabel }}</Badge>
        </div>
        <p>{{ t('control.subtitle') }}</p>
      </div>
      <Button v-if="showClose" variant="ghost" size="icon" class="size-8" :title="t('common.close')" @click="emit('close')">
        <X class="size-4" />
      </Button>
    </header>

    <div v-if="!ready || !settings" class="booster-loading">{{ t('control.loading') }}</div>

    <div v-else class="booster-control-body">
      <section class="booster-setting-card">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2"><Settings2 class="size-4" /><b>{{ t('control.booster') }}</b></div>
          <span>{{ t('control.boosterDescription') }}</span>
        </div>
        <button type="button" class="booster-switch" :class="{ 'booster-switch-on': settings.enabled }" :aria-pressed="settings.enabled" @click="settings.enabled = !settings.enabled; persist()"><span /></button>
      </section>

      <section class="booster-setting-card">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2"><Languages class="size-4" /><b>{{ t('control.language') }}</b></div>
          <span>{{ t('control.languageDescription') }}</span>
        </div>
        <select class="booster-select" :value="settings.language" :aria-label="t('control.language')" @change="setLanguage">
          <option value="auto">{{ t('common.auto') }}</option><option value="en">{{ t('language.english') }}</option><option value="ru">{{ t('language.russian') }}</option>
        </select>
      </section>

      <div class="booster-section-label">{{ t('control.modules') }}</div>

      <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2"><Wrench class="size-4" /><b>{{ t('control.toolInspector') }}</b><Badge :variant="settings.features.toolInspector && settings.enabled ? 'default' : 'secondary'">{{ settings.features.toolInspector && settings.enabled ? t('common.on') : t('common.off') }}</Badge></div>
          <span>{{ t('control.toolInspectorDescription') }}</span>
        </div>
        <button type="button" class="booster-switch" :class="{ 'booster-switch-on': settings.features.toolInspector }" :disabled="!settings.enabled" :aria-pressed="settings.features.toolInspector" @click="settings.features.toolInspector = !settings.features.toolInspector; persist()"><span /></button>
      </section>

      <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2"><Activity class="size-4" /><b>{{ t('control.observer') }}</b><Badge :variant="settings.observer.enabled && settings.enabled ? 'default' : 'secondary'">{{ settings.observer.enabled && settings.enabled ? t('common.on') : t('common.off') }}</Badge></div>
          <span>{{ t('control.observerDescription') }}</span>
        </div>
        <button type="button" class="booster-switch" :class="{ 'booster-switch-on': settings.observer.enabled }" :disabled="!settings.enabled" :aria-pressed="settings.observer.enabled" @click="settings.observer.enabled = !settings.observer.enabled; persist()"><span /></button>
      </section>

      <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.observer.enabled }">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2"><ShieldCheck class="size-4" /><b>{{ t('control.captureBodies') }}</b></div>
          <span>{{ t('control.captureBodiesDescription') }}</span>
        </div>
        <button type="button" class="booster-switch" :class="{ 'booster-switch-on': settings.observer.captureBodies }" :disabled="!settings.observer.enabled" :aria-pressed="settings.observer.captureBodies" @click="settings.observer.captureBodies = !settings.observer.captureBodies; persist()"><span /></button>
      </section>

      <section v-if="diagnosticsAdapter" class="booster-info-card">
        <div class="flex items-center gap-2 font-medium"><Radio class="size-4" />{{ t('control.transportCounters') }}</div>
        <div class="booster-counter-grid">
          <span>{{ t('control.requestsSent') }} <b>{{ counters.requestsSent }}</b></span>
          <span>{{ t('control.responsesReceived') }} <b>{{ counters.responsesReceived }}</b></span>
          <span>{{ t('control.messagesSent') }} <b>{{ counters.messagesSent }}</b></span>
          <span>{{ t('control.messagesReceived') }} <b>{{ counters.messagesReceived }}</b></span>
          <span>{{ t('control.errors') }} <b>{{ counters.errors }}</b></span>
        </div>
      </section>

      <div class="booster-section-label">{{ t('control.telemetry') }}</div>
      <section class="booster-setting-card">
        <div class="booster-setting-copy"><b>{{ t('control.telemetry') }}</b><span>{{ t('control.telemetryDescription') }}</span></div>
        <button type="button" class="booster-switch" :class="{ 'booster-switch-on': settings.telemetry.enabled }" :aria-pressed="settings.telemetry.enabled" @click="settings.telemetry.enabled = !settings.telemetry.enabled; persist()"><span /></button>
      </section>

      <section class="booster-stack-card">
        <label><span>{{ t('control.telemetryEndpoint') }}</span><input v-model="settings.telemetry.endpoint" class="booster-input" @change="persist" /></label>
        <label v-if="secretAdapter">
          <span class="flex items-center justify-between gap-2">{{ t('control.telemetryToken') }}<Badge :variant="tokenConfigured ? 'default' : 'secondary'">{{ tokenConfigured ? t('control.tokenConfigured') : t('control.tokenMissing') }}</Badge></span>
          <div class="flex gap-2"><input v-model="tokenDraft" class="booster-input" type="password" autocomplete="off" /><Button variant="outline" size="sm" :disabled="!tokenDraft.trim()" @click="saveToken">{{ t('control.saveToken') }}</Button></div>
        </label>
      </section>

      <footer class="booster-control-footer"><span class="booster-save-state"><Check v-if="saved" class="size-3.5" />{{ saving ? t('control.saving') : saved ? t('control.saved') : t('control.live') }}</span></footer>
    </div>
  </section>
</template>
