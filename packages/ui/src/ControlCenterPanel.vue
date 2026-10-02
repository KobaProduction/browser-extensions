<script setup lang="ts">
import type {
  BoosterSettings,
  LanguagePreference,
  SettingsAdapter,
} from '@chatgpt-booster/core'
import { Check, ChevronRight, Languages, RotateCcw, Settings2, Wrench, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { resolveLocale, translate } from './i18n'

const props = withDefaults(
  defineProps<{
    settingsAdapter: SettingsAdapter
    target: 'extension' | 'userscript'
    showClose?: boolean
  }>(),
  { showClose: false },
)

const emit = defineEmits<{ close: [] }>()
const ready = ref(false)
const saving = ref(false)
const saved = ref(false)
const settings = ref<BoosterSettings>()
let unsubscribe: (() => void) | undefined
let savedTimer: number | undefined

const locale = computed(() => resolveLocale(settings.value?.language ?? 'auto'))
const t = (key: Parameters<typeof translate>[1]) => translate(locale.value, key)
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

async function setLanguage(event: Event) {
  if (!settings.value) return
  settings.value.language = (event.target as HTMLSelectElement).value as LanguagePreference
  await persist()
}

async function reset() {
  if (!settings.value) return
  settings.value.enabled = true
  settings.value.features.toolInspector = true
  await persist()
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
      <Button
        v-if="showClose"
        variant="ghost"
        size="icon"
        class="size-8"
        :title="t('common.close')"
        @click="emit('close')"
      >
        <X class="size-4" />
      </Button>
    </header>

    <div v-if="!ready || !settings" class="booster-loading">{{ t('control.loading') }}</div>

    <div v-else class="booster-control-body">
      <section class="booster-setting-card">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2">
            <Settings2 class="size-4" />
            <b>{{ t('control.booster') }}</b>
          </div>
          <span>{{ t('control.boosterDescription') }}</span>
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

      <section class="booster-setting-card">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2">
            <Languages class="size-4" />
            <b>{{ t('control.language') }}</b>
          </div>
          <span>{{ t('control.languageDescription') }}</span>
        </div>
        <select
          class="booster-select"
          :value="settings.language"
          :aria-label="t('control.language')"
          @change="setLanguage"
        >
          <option value="auto">{{ t('common.auto') }}</option>
          <option value="en">{{ t('language.english') }}</option>
          <option value="ru">{{ t('language.russian') }}</option>
        </select>
      </section>

      <div class="booster-section-label">{{ t('control.modules') }}</div>

      <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
        <div class="booster-setting-copy">
          <div class="flex items-center gap-2">
            <Wrench class="size-4" />
            <b>{{ t('control.toolInspector') }}</b>
            <Badge :variant="settings.features.toolInspector && settings.enabled ? 'default' : 'secondary'">
              {{ settings.features.toolInspector && settings.enabled ? t('common.on') : t('common.off') }}
            </Badge>
          </div>
          <span>{{ t('control.toolInspectorDescription') }}</span>
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
          {{ t('control.currentBehavior') }}
        </div>
        <ul>
          <li>{{ t('control.behaviorChatgpt') }}</li>
          <li>{{ t('control.behaviorLocal') }}</li>
          <li>{{ t('control.behaviorPrivacy') }}</li>
          <li>{{ t('control.behaviorTool') }}</li>
        </ul>
      </section>

      <footer class="booster-control-footer">
        <Button variant="ghost" size="sm" class="gap-1.5" @click="reset">
          <RotateCcw class="size-3.5" />
          {{ t('control.resetModules') }}
        </Button>
        <span class="booster-save-state">
          <Check v-if="saved" class="size-3.5" />
          {{ saving ? t('control.saving') : saved ? t('control.saved') : t('control.live') }}
        </span>
      </footer>
    </div>
  </section>
</template>
