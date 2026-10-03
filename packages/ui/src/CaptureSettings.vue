<script setup lang="ts">
import { captureRuleFor, DEFAULT_CAPTURE_RULE, snapshotSettings, type ArchiveCaptureContext, type BoosterSettings, type CaptureRule, type SettingsAdapter } from '@chatgpt-booster/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CopyIdentity from './CopyIdentity.vue'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type { ArchiveDataAdapter, ArchiveConversationView, ArchiveProjectView } from './mount'
const props = defineProps<{ settingsAdapter: SettingsAdapter; archiveAdapter?: ArchiveDataAdapter | undefined; context?: ArchiveCaptureContext | undefined; locale: SupportedLocale }>()
const settings = ref<BoosterSettings>()
const contexts = ref<ArchiveCaptureContext[]>([])
const projects = ref<ArchiveProjectView[]>([]), conversations = ref<ArchiveConversationView[]>([])
const selected = ref('default'), mode = ref<'inherit' | 'on' | 'off'>('off')
const rule = ref<CaptureRule>({ ...DEFAULT_CAPTURE_RULE })
const busy = ref(false), error = ref(false), saved = ref(false)
const t = (key: TranslationKey) => translate(props.locale, key)
let unsubscribe: (() => void) | undefined, alive = true
const keyFor = (context: ArchiveCaptureContext) => `${context.scope}:${context.id}`
const scopes = computed(() => {
  const values = new Map<string, ArchiveCaptureContext>()
  for (const id of Object.keys(settings.value?.archive.projects ?? {})) values.set(`project:${id}`, { scope: 'project', id, title: projects.value.find(p => p.projectId === id)?.title ?? null })
  for (const id of Object.keys(settings.value?.archive.conversations ?? {})) {
    const c = conversations.value.find(c => c.conversationId === id)
    values.set(`conversation:${id}`, { scope: 'conversation', id, title: c?.title ?? null, projectId: c?.projectId ?? null })
  }
  for (const c of contexts.value) values.set(keyFor(c), c)
  if (props.context) values.set(keyFor(props.context), props.context)
  return [...values.values()]
})
const target = computed(() => scopes.value.find(c => keyFor(c) === selected.value))
function loadRule() {
  const archive = settings.value?.archive
  if (!archive) return
  const scope = target.value
  const own = !scope ? archive.defaultRule : scope.scope === 'project' ? archive.projects[scope.id] : archive.conversations[scope.id]
  const effective = own ?? (scope?.scope === 'conversation' ? captureRuleFor(archive, scope.id, scope.projectId ?? null) : archive.defaultRule)
  rule.value = { ...effective }
  mode.value = own ? own.enabled ? 'on' : 'off' : 'inherit'
  saved.value = false
}
watch(selected, loadRule)
watch(() => props.context, (value) => { if (value) { selected.value = keyFor(value); loadRule() } })
onMounted(async () => {
  try {
    const next = await props.settingsAdapter.get()
    if (!alive) return
    settings.value = snapshotSettings(next)
    unsubscribe = props.settingsAdapter.subscribe(s => { settings.value = snapshotSettings(s) })
    if (props.archiveAdapter) {
      const [current, ps, cs] = await Promise.all([props.archiveAdapter.getCurrentContext(), props.archiveAdapter.listProjects(), props.archiveAdapter.listConversations()])
      if (!alive) return
      projects.value = ps; conversations.value = cs
      if (current.projectId) contexts.value.push({ scope: 'project', id: current.projectId, title: current.projectTitle })
      if (current.conversationId) contexts.value.push({ scope: 'conversation', id: current.conversationId, title: current.conversationTitle, projectId: current.projectId })
    }
    selected.value = props.context ? keyFor(props.context) : contexts.value.at(-1) ? keyFor(contexts.value.at(-1) as ArchiveCaptureContext) : 'default'
    loadRule()
  } catch { error.value = true; loadRule() }
})
onBeforeUnmount(() => { alive = false; unsubscribe?.() })
async function save() {
  if (busy.value || !settings.value) return
  busy.value = true; error.value = false; saved.value = false
  const scope = target.value
  const next = { ...rule.value, enabled: mode.value === 'on' }
  try {
    const patch = scope ? scope.scope === 'project' ? { projects: { [scope.id]: mode.value === 'inherit' ? null : next } } : { conversations: { [scope.id]: mode.value === 'inherit' ? null : next } } : { defaultRule: next }
    settings.value = snapshotSettings(await props.settingsAdapter.update({ archive: patch }))
    saved.value = true
  } catch { error.value = true }
  finally { busy.value = false }
}
</script>
<template>
  <section class="booster-capture-settings">
    <h3>{{ t('capture.title') }}</h3><p class="booster-note">{{ t('capture.explanation') }}</p>
    <div v-if="settings" class="booster-form-body">
      <label>{{ t('capture.scope') }}<select v-model="selected" :disabled="busy"><option value="default">{{ t('capture.global') }}</option><option v-for="scope in scopes" :key="keyFor(scope)" :value="keyFor(scope)">{{ t(scope.scope === 'project' ? 'capture.project' : 'capture.conversation') }}: {{ scope.title || t(scope.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled') }}</option></select></label>
      <CopyIdentity v-if="target" :label="target.title || t(target.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled')" :identifier="target.id" :locale="locale" />
      <label>{{ t('capture.policy') }}<select v-model="mode" :disabled="busy"><option v-if="target" value="inherit">{{ t('capture.inherit') }}</option><option value="on">{{ t('capture.on') }}</option><option value="off">{{ t('capture.off') }}</option></select></label>
      <fieldset :disabled="busy || mode === 'inherit'" class="booster-checkboxes"><label><input v-model="rule.reasoning" type="checkbox" />{{ t('capture.reasoning') }}</label><label><input v-model="rule.tools" type="checkbox" />{{ t('capture.tools') }}</label><label><input v-model="rule.internal" type="checkbox" />{{ t('capture.internal') }}</label></fieldset>
      <p class="booster-note">{{ t('capture.scopeHint') }}</p>
      <button type="button" class="booster-action-primary" :disabled="busy" @click="save">{{ t(busy ? 'control.saving' : 'capture.apply') }}</button>
      <p v-if="error" role="alert" class="booster-error">{{ t('common.saveError') }}</p><p v-if="saved" role="status">{{ t('capture.saved') }}</p>
    </div><p v-else class="booster-note">{{ t(error ? 'common.saveError' : 'control.loading') }}</p>
  </section>
</template>
