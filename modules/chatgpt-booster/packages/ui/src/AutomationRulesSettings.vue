<script setup lang="ts">
import type {
  BoosterSettings,
  BoosterSettingsPatch,
  ChatGptAutomationControl,
  ChatGptAutomationStatus,
} from '@chatgpt-booster/core'
import { type AutomationRule, validateAutomationRules } from '@kobaproduction/browser-core'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SettingRow,
  Switch,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import AutomationRuleEditor from './AutomationRuleEditor.vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{
  settings: BoosterSettings
  status?: ChatGptAutomationStatus
  control?: ChatGptAutomationControl
  saveSettings: (patch: BoosterSettingsPatch) => Promise<boolean>
}>()
const emit = defineEmits<{ refresh: [] }>()
const id = useId()
const copyRules = (rules: readonly AutomationRule[]) =>
  validateAutomationRules(JSON.parse(JSON.stringify(rules)))
const localDraft = ref<readonly AutomationRule[]>(copyRules(props.settings.automation.rules))
const rules = computed(() => props.status?.triggers.draftRules ?? localDraft.value)
const unsaved = computed(
  () =>
    props.status?.triggers.unsaved ??
    JSON.stringify(localDraft.value) !== JSON.stringify(props.settings.automation.rules),
)
const busy = ref(false),
  error = ref(''),
  editorOpen = ref(false)
const editing = ref<AutomationRule>(),
  editorKey = ref(0)
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
watch(
  () => props.settings.automation.rules,
  (next, previous) => {
    if (JSON.stringify(localDraft.value) === JSON.stringify(previous)) localDraft.value = copyRules(next)
  },
)
const eventTitles = {
  message: 'Сообщение',
  api: 'Событие API',
  dom: 'Устаревшее событие интерфейса (не поддерживается)',
  completion: 'Завершение',
  limit: 'Лимит',
  conflict: 'Конфликт',
} as const
function edit(rule?: AutomationRule) {
  editing.value = rule ? copyRules([rule])[0] : undefined
  editorKey.value++
  editorOpen.value = true
  error.value = ''
}
async function applyRules(next: readonly AutomationRule[]) {
  if (busy.value) return false
  const control = props.control
  busy.value = true
  error.value = ''
  try {
    const validated = copyRules(next)
    if (control) await control.dispatch('triggers-draft-set', { rules: validated })
    else localDraft.value = validated
    if (disposed || control !== props.control) return false
    emit('refresh')
    return true
  } catch {
    if (!disposed)
      error.value = 'Не удалось применить правила в памяти. Сохранённые правила не изменены.'
    return false
  } finally {
    busy.value = false
  }
}
async function applyRule(rule: AutomationRule) {
  if (
    editing.value &&
    JSON.stringify(rules.value.find((item) => item.id === editing.value?.id)) !==
      JSON.stringify(editing.value)
  ) {
    error.value =
      'Правило изменилось во время редактирования. Отмените редактирование и откройте его заново.'
    return
  }
  if (await applyRules([...rules.value.filter((item) => item.id !== rule.id), rule]))
    editorOpen.value = false
}
async function saveDraft() {
  if (busy.value || !unsaved.value || editorOpen.value) return
  const control = props.control
  busy.value = true
  error.value = ''
  try {
    if (control) await control.dispatch('triggers-draft-save', {})
    else if (!(await props.saveSettings({ automation: { rules: copyRules(localDraft.value) } })))
      throw Error('Settings write failed')
    if (!disposed && control === props.control) emit('refresh')
  } catch {
    if (!disposed) error.value = 'Не удалось сохранить правила. Изменения остаются в памяти.'
  } finally {
    busy.value = false
  }
}
async function discardDraft() {
  if (busy.value) return
  const control = props.control
  busy.value = true
  error.value = ''
  try {
    if (control) await control.dispatch('triggers-draft-discard', {})
    else localDraft.value = copyRules(props.settings.automation.rules)
    if (!disposed && control === props.control) {
      editorOpen.value = false
      emit('refresh')
    }
  } catch {
    if (!disposed) error.value = 'Не удалось отменить изменения. Правила в памяти не сброшены.'
  } finally {
    busy.value = false
  }
}
function toggle(rule: AutomationRule, value: boolean) {
  void applyRules(rules.value.map((item) => (item.id === rule.id ? { ...item, enabled: value } : item)))
}
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2">
      <SettingRow :id="`${id}-enabled`" :title="text('Включить триггеры')" :description="text('Условия запускают действия по сетевым событиям ChatGPT.')" :model-value="settings.automation.enabled" @update:model-value="saveSettings({ automation: { enabled: $event } })" />
    </div>
    <Card>
      <CardHeader class="gap-2 p-4 pb-3">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2"><CardTitle class="text-base">{{ text('Правила ') }}<span class="font-normal text-muted-foreground">{{ rules.length }} / 64</span></CardTitle><Badge :variant="unsaved ? 'outline' : 'secondary'">{{ unsaved ? text('Есть изменения в памяти') : text('Все правила сохранены') }}</Badge></div>
        <CardDescription>{{ text('Применение меняет правила в памяти. Сохраните их отдельно, чтобы оставить после перезапуска.') }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3 p-4 pt-0" :aria-busy="busy">
        <div v-if="unsaved" class="flex flex-wrap items-center gap-2"><Button size="sm" :disabled="busy || editorOpen" @click="saveDraft">{{ text('Сохранить изменения') }}</Button><Button variant="outline" size="sm" :disabled="busy" @click="discardDraft">{{ text('Отменить изменения') }}</Button><span v-if="editorOpen" class="text-xs text-muted-foreground">{{ text('Сначала примените или отмените редактирование.') }}</span></div>
        <p v-if="!rules.length && !editorOpen" class="text-sm text-muted-foreground">{{ text('Добавьте первое правило: выберите событие, условие и действие.') }}</p>
        <div v-if="rules.length" class="divide-y">
          <div v-for="rule in rules" :key="rule.id" class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0">
            <Switch :model-value="rule.enabled" :disabled="busy || editorOpen || rule.trigger.type === 'dom'" :aria-label="`${text('Включить ')}${rule.label}`" @update:model-value="toggle(rule, $event)" />
            <div class="min-w-0 flex-1 basis-32"><p class="break-words text-sm font-medium">{{ rule.label }}</p><p class="text-xs leading-5 text-muted-foreground">{{ text(eventTitles[rule.trigger.type]) }}{{ text(' · действий: ') }}{{ rule.actions.length }}</p></div>
            <div class="flex shrink-0 gap-1"><Button variant="ghost" size="sm" :disabled="busy || editorOpen" :aria-label="`${text('Изменить правило ')}${rule.label}`" @click="edit(rule)">{{ text('Изменить') }}</Button><Button variant="ghost" size="sm" :disabled="busy || editorOpen" :aria-label="`${text('Удалить правило ')}${rule.label}${text(' из памяти')}`" @click="applyRules(rules.filter(item => item.id !== rule.id))">{{ text('Удалить') }}</Button></div>
          </div>
        </div>
        <Button v-if="!editorOpen && rules.length < 64" variant="outline" :disabled="busy" @click="edit()">{{ text('Добавить правило') }}</Button>
        <AutomationRuleEditor v-if="editorOpen" :key="editorKey" :rule="editing" :disabled="busy" @apply="applyRule" @cancel="editorOpen = false" />
        <Alert v-if="error" variant="destructive"><AlertDescription>{{ text(error) }}</AlertDescription></Alert>
      </CardContent>
    </Card>
  </div>
</template>
