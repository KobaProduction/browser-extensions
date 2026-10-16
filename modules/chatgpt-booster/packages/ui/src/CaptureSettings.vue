<script setup lang="ts">
import {
  type ArchiveCaptureContext,
  type ArchiveCurrentContext,
  type BoosterSettings,
  type CaptureRule,
  captureRuleFor,
  DEFAULT_CAPTURE_RULE,
  resolveCaptureRule,
  type SettingsAdapter,
  snapshotSettings,
} from '@chatgpt-booster/core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kobaproduction/browser-ui'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import CopyIdentity from './CopyIdentity.vue'
import { type SupportedLocale, type TranslationKey, translate } from './i18n'
import type { ArchiveConversationView, ArchiveDataAdapter, ArchiveProjectView } from './mount'

const props = defineProps<{
  settingsAdapter: SettingsAdapter
  archiveAdapter?: ArchiveDataAdapter | undefined
  context?: ArchiveCaptureContext | undefined
  locale: SupportedLocale
}>()
const fieldId = useId()
const settings = ref<BoosterSettings>()
const contexts = ref<ArchiveCaptureContext[]>([])
const currentContext = ref<ArchiveCurrentContext>()
const projects = ref<ArchiveProjectView[]>([]),
  conversations = ref<ArchiveConversationView[]>([])
const selected = ref('default'),
  mode = ref<'inherit' | 'on' | 'off'>('off')
const rule = ref<CaptureRule>({ ...DEFAULT_CAPTURE_RULE })
const busy = ref(false),
  saveError = ref(false),
  settingsLoadError = ref(false),
  contextsLoadError = ref(false),
  saved = ref(false)
const t = (key: TranslationKey) => translate(props.locale, key)
let unsubscribe: (() => void) | undefined,
  alive = true,
  draftTouched = false
const keyFor = (context: ArchiveCaptureContext) => `${context.scope}:${context.id}`
const scopes = computed(() => {
  const values = new Map<string, ArchiveCaptureContext>()
  for (const project of projects.value)
    values.set(`project:${project.projectId}`, {
      scope: 'project',
      id: project.projectId,
      title: project.title,
    })
  for (const id of Object.keys(settings.value?.archive.projects ?? {}))
    values.set(`project:${id}`, {
      scope: 'project',
      id,
      title: projects.value.find((p) => p.projectId === id)?.title ?? null,
    })
  for (const id of Object.keys(settings.value?.archive.conversations ?? {})) {
    const c = conversations.value.find((c) => c.conversationId === id)
    values.set(`conversation:${id}`, {
      scope: 'conversation',
      id,
      title: c?.title ?? null,
      projectId: c?.projectId ?? null,
    })
  }
  for (const c of contexts.value) values.set(keyFor(c), c)
  if (props.context) values.set(keyFor(props.context), props.context)
  return [...values.values()]
})
const target = computed(() => scopes.value.find((c) => keyFor(c) === selected.value))
const selectedScopeLabel = computed(() => {
  const scope = target.value
  if (!scope) return t('capture.global')
  return `${t(scope.scope === 'project' ? 'capture.project' : 'capture.conversation')}: ${scope.title || t(scope.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled')}`
})
const persistedCapture = computed(() => {
  const saved = settings.value
  if (!saved) return null
  const scope = target.value
  const projectRule = scope?.scope === 'project' ? saved.archive.projects[scope.id] : undefined
  const resolved =
    scope?.scope === 'conversation'
      ? resolveCaptureRule(saved.archive, scope.id, scope.projectId ?? null)
      : projectRule
        ? { rule: projectRule, source: 'project' as const }
        : { rule: saved.archive.defaultRule, source: 'default' as const }
  return { enabled: saved.enabled && resolved.rule.enabled, source: resolved.source }
})
const currentProjectCapture = computed(() => {
  const saved = settings.value,
    context = currentContext.value
  if (!saved || !context?.projectId) return null
  const projectRule = saved.archive.projects[context.projectId]
  return {
    title:
      context.projectTitle ||
      projects.value.find((project) => project.projectId === context.projectId)?.title ||
      t('identity.unknownProject'),
    enabled: saved.enabled && (projectRule ?? saved.archive.defaultRule).enabled,
    source: projectRule ? ('project' as const) : ('default' as const),
  }
})
function loadRule() {
  const archive = settings.value?.archive
  if (!archive) return
  const scope = target.value
  const own = !scope
    ? archive.defaultRule
    : scope.scope === 'project'
      ? archive.projects[scope.id]
      : archive.conversations[scope.id]
  const effective =
    own ??
    (scope?.scope === 'conversation'
      ? captureRuleFor(archive, scope.id, scope.projectId ?? null)
      : archive.defaultRule)
  rule.value = { ...effective }
  mode.value = own ? (own.enabled ? 'on' : 'off') : 'inherit'
  saved.value = false
}
watch(selected, loadRule)
watch(
  () => props.context,
  (value) => {
    if (value) {
      selected.value = keyFor(value)
      loadRule()
    }
  },
)
onMounted(async () => {
  try {
    const next = await props.settingsAdapter.get()
    if (!alive) return
    settings.value = snapshotSettings(next)
    selected.value = props.context ? keyFor(props.context) : 'default'
    loadRule()
    unsubscribe = props.settingsAdapter.subscribe((s) => {
      settings.value = snapshotSettings(s)
    })
  } catch {
    if (alive) settingsLoadError.value = true
    return
  }
  try {
    if (props.archiveAdapter) {
      const [current, ps, cs] = await Promise.all([
        props.archiveAdapter.getCurrentContext(),
        props.archiveAdapter.listProjects(),
        props.archiveAdapter.listConversations(),
      ])
      if (!alive) return
      currentContext.value = current
      projects.value = ps
      conversations.value = cs
      if (current.projectId)
        contexts.value.push({ scope: 'project', id: current.projectId, title: current.projectTitle })
      if (current.conversationId)
        contexts.value.push({
          scope: 'conversation',
          id: current.conversationId,
          title: current.conversationTitle,
          projectId: current.projectId,
        })
    }
  } catch {
    if (alive) contextsLoadError.value = true
  }
  if (!alive || draftTouched) return
  selected.value = props.context
    ? keyFor(props.context)
    : contexts.value.at(-1)
      ? keyFor(contexts.value.at(-1) as ArchiveCaptureContext)
      : 'default'
  loadRule()
})
onBeforeUnmount(() => {
  alive = false
  unsubscribe?.()
})
async function save() {
  if (busy.value || !settings.value) return
  draftTouched = true
  busy.value = true
  saveError.value = false
  saved.value = false
  const scope = target.value
  const next = { ...rule.value, enabled: mode.value === 'on' }
  try {
    const patch = scope
      ? scope.scope === 'project'
        ? { projects: { [scope.id]: mode.value === 'inherit' ? null : next } }
        : { conversations: { [scope.id]: mode.value === 'inherit' ? null : next } }
      : { defaultRule: next }
    settings.value = snapshotSettings(await props.settingsAdapter.update({ archive: patch }))
    saved.value = true
  } catch {
    saveError.value = true
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <Card class="booster-capture-settings min-w-0" data-capture-settings>
    <CardHeader class="gap-2 p-4 pb-3">
      <CardTitle class="text-base">{{ t('capture.title') }}</CardTitle>
      <CardDescription class="text-xs leading-5">{{ t('capture.explanation') }}</CardDescription>
    </CardHeader>
    <CardContent v-if="settings" class="grid min-w-0 gap-4 p-4 pt-0">
      <Alert v-if="contextsLoadError"><AlertDescription role="status">{{ t('capture.contextsUnavailable') }}</AlertDescription></Alert>
      <div class="grid min-w-0 gap-2">
        <Label :for="`${fieldId}-scope`">{{ t('capture.scope') }}</Label>
        <Select v-model="selected" :disabled="busy" @update:model-value="draftTouched = true"><SelectTrigger :id="`${fieldId}-scope`" class="w-full"><SelectValue>{{ selectedScopeLabel }}</SelectValue></SelectTrigger><SelectContent><SelectItem value="default">{{ t('capture.global') }}</SelectItem><SelectItem v-for="scope in scopes" :key="keyFor(scope)" :value="keyFor(scope)">{{ t(scope.scope === 'project' ? 'capture.project' : 'capture.conversation') }}: {{ scope.title || t(scope.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled') }}</SelectItem></SelectContent></Select>
      </div>
      <CopyIdentity v-if="target" :label="target.title || t(target.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled')" :identifier="target.id" :locale="locale" />
      <Alert v-if="persistedCapture" role="status"><AlertDescription class="grid gap-2 text-xs leading-5">
        <p class="m-0" data-capture-effective>{{ t('capture.savedPolicy') }}: {{ t(persistedCapture.enabled ? 'dock.autoOn' : 'dock.autoOff') }} · {{ t('scope.rule') }}: {{ t(`scope.source.${persistedCapture.source}`) }}</p>
        <p v-if="currentProjectCapture" class="m-0" data-capture-project-status>{{ t('capture.currentProject') }}: {{ currentProjectCapture.title }} · {{ t(currentProjectCapture.enabled ? 'dock.autoOn' : 'dock.autoOff') }} · {{ t('scope.rule') }}: {{ t(`scope.source.${currentProjectCapture.source}`) }}</p>
      </AlertDescription></Alert>
      <div class="grid min-w-0 gap-2">
        <Label :for="`${fieldId}-policy`">{{ t('capture.policy') }}</Label>
        <Select v-model="mode" :disabled="busy" @update:model-value="draftTouched = true"><SelectTrigger :id="`${fieldId}-policy`" class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-if="target" value="inherit">{{ t('capture.inherit') }}</SelectItem><SelectItem value="on">{{ t('capture.on') }}</SelectItem><SelectItem value="off">{{ t('capture.off') }}</SelectItem></SelectContent></Select>
      </div>
      <fieldset :disabled="busy || mode === 'inherit'" class="grid min-w-0 gap-3 border-0 p-0">
        <Label :for="`${fieldId}-reasoning`" class="flex min-h-6 items-start gap-2 leading-5"><Checkbox :id="`${fieldId}-reasoning`" v-model="rule.reasoning" class="mt-0.5 shrink-0" @update:model-value="draftTouched = true" />{{ t('capture.reasoning') }}</Label>
        <Label :for="`${fieldId}-tools`" class="flex min-h-6 items-start gap-2 leading-5"><Checkbox :id="`${fieldId}-tools`" v-model="rule.tools" class="mt-0.5 shrink-0" @update:model-value="draftTouched = true" />{{ t('capture.tools') }}</Label>
        <Label :for="`${fieldId}-internal`" class="flex min-h-6 items-start gap-2 leading-5"><Checkbox :id="`${fieldId}-internal`" v-model="rule.internal" class="mt-0.5 shrink-0" @update:model-value="draftTouched = true" />{{ t('capture.internal') }}</Label>
      </fieldset>
      <p class="m-0 text-xs leading-5 text-muted-foreground">{{ t('capture.scopeHint') }}</p>
      <Button variant="default" type="button" class="h-auto min-h-9 whitespace-normal" :disabled="busy" @click="save">{{ t(busy ? 'control.saving' : 'capture.apply') }}</Button>
      <Alert v-if="saveError" variant="destructive"><AlertDescription role="alert">{{ t('common.saveError') }}</AlertDescription></Alert>
      <p v-if="saved" role="status" class="m-0 text-xs leading-5">{{ t('capture.saved') }}</p>
    </CardContent>
    <CardContent v-else class="p-4 pt-0"><p class="m-0 text-xs leading-5 text-muted-foreground" :role="settingsLoadError ? 'alert' : 'status'">{{ t(settingsLoadError ? 'capture.settingsUnavailable' : 'control.loading') }}</p></CardContent>
  </Card>
</template>
