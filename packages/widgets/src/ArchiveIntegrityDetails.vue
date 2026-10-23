<script setup lang="ts">
import type { ArchiveConversationIntegrity } from '@kobaproduction/browser-archive'
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kobaproduction/browser-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  integrity: ArchiveConversationIntegrity
  locale: 'ru' | 'en'
  complete?: boolean
}>()
const emit = defineEmits<{ inspect: [messageId: string] }>()
const text = (ru: string, en: string) => (props.locale === 'ru' ? ru : en)
const diagnostics = ref(false)
const page = ref(0)
const pageSize = 8
const pageCount = computed(() => Math.max(1, Math.ceil(props.integrity.issues.length / pageSize)))
const visibleIssues = computed(() =>
  props.integrity.issues.slice(page.value * pageSize, (page.value + 1) * pageSize),
)
watch(
  () => props.integrity,
  () => {
    page.value = 0
  },
)
const labels: Record<ArchiveConversationIntegrity['issues'][number]['reason'], [string, string]> = {
  'missing-parent': ['Не хватает предыдущих сообщений', 'Earlier messages missing'],
  'unverified-root': ['Начало фрагмента не подтверждено', 'Fragment start unverified'],
  'missing-head': ['Последнее сообщение не сохранено', 'Latest message missing'],
  disconnected: ['Несвязанные фрагменты', 'Disconnected fragments'],
  cycle: ['Циклическая связь', 'Cyclic relationship'],
  'duplicate-id': ['Повтор идентификатора', 'Duplicate identity'],
}
const groups = computed(() =>
  Object.entries(labels).flatMap(([reason, label]) => {
    const count = props.integrity.issues.filter((issue) => issue.reason === reason).length
    return count ? [{ reason, label: label[props.locale === 'ru' ? 0 : 1], count }] : []
  }),
)
const evidence = (value: string) =>
  value === 'verified'
    ? text('Подтверждено', 'Verified')
    : value === 'missing'
      ? text('Не сохранено', 'Not saved')
      : text('Не подтверждено', 'Unverified')
</script>

<template>
  <section class="min-w-0 space-y-4" data-archive-integrity-details>
    <div class="space-y-1">
      <p class="font-medium">{{ complete ? text('История сохранена', 'History saved') : integrity.issues.length ? text('Историю нужно дополнить', 'History needs recovery') : text('Полнота ещё не подтверждена', 'Completeness not yet verified') }}</p>
      <p v-if="!complete" class="text-sm text-muted-foreground">{{ text('Соберите историю, чтобы загрузить доступные сообщения и проверить их связи. Сохранённые записи останутся в архиве.', 'Collect history to load available messages and verify their links. Existing records stay in the archive.') }}</p>
    </div>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div><dt class="text-muted-foreground">{{ text('Начало', 'Start') }}</dt><dd class="font-medium">{{ evidence(integrity.start) }}</dd></div>
      <div><dt class="text-muted-foreground">{{ text('Последнее сообщение', 'Latest message') }}</dt><dd class="font-medium">{{ evidence(integrity.end) }}</dd></div>
      <div><dt class="text-muted-foreground">{{ text('Связи сообщений', 'Message links') }}</dt><dd class="font-medium">{{ evidence(integrity.chain) }}</dd></div>
      <div><dt class="text-muted-foreground">{{ text('Проблемы связности', 'Link issues') }}</dt><dd class="font-medium">{{ integrity.issues.length.toLocaleString(locale) }}</dd></div>
    </dl>
    <ul v-if="groups.length" class="space-y-1 border-t pt-3 text-sm" :aria-label="text('Проблемы архива', 'Archive issues')">
      <li v-for="group in groups" :key="group.reason" class="flex justify-between gap-3"><span>{{ group.label }}</span><span class="tabular-nums text-muted-foreground">{{ group.count.toLocaleString(locale) }}</span></li>
    </ul>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
    <div class="flex flex-wrap gap-2">
      <Button v-if="integrity.firstMessageId" variant="outline" size="sm" @click="emit('inspect', integrity.firstMessageId)">{{ text('Первое сообщение', 'First message') }}</Button>
      <Button v-if="integrity.lastMessageId" variant="outline" size="sm" @click="emit('inspect', integrity.lastMessageId)">{{ text('Последнее сообщение', 'Latest message') }}</Button>
    </div>
    <Collapsible v-if="integrity.issues.length" v-model:open="diagnostics" class="border-t pt-2">
      <CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="px-0">{{ diagnostics ? text('Скрыть технические подробности', 'Hide technical details') : text('Технические подробности', 'Technical details') }}</Button></CollapsibleTrigger>
      <CollapsibleContent class="space-y-3 pt-2">
        <p class="text-xs text-muted-foreground">{{ text('Диагностические идентификаторы не являются текстом сообщений.', 'Diagnostic IDs are not message text.') }}</p>
        <ol class="space-y-2">
          <li v-for="issue in visibleIssues" :key="issue.reason + issue.messageId" class="min-w-0 border-b pb-2 text-xs" data-integrity-issue>
            <Button variant="link" size="sm" class="h-auto max-w-full whitespace-normal px-0 text-left text-xs" @click="emit('inspect', issue.reason === 'missing-head' ? (integrity.tips.at(-1) ?? issue.messageId) : issue.messageId)">{{ labels[issue.reason][locale === 'ru' ? 0 : 1] }}</Button>
            <p class="break-all font-mono text-muted-foreground">{{ issue.messageId }}</p>
            <p v-if="issue.parentId" class="break-all font-mono text-muted-foreground">← {{ issue.parentId }}</p>
          </li>
        </ol>
        <nav class="flex items-center justify-between gap-2" :aria-label="text('Страницы диагностики', 'Diagnostic pages')">
          <Button variant="outline" size="sm" :disabled="page === 0" @click="page--">{{ text('Назад', 'Previous') }}</Button>
          <span class="text-xs tabular-nums text-muted-foreground">{{ page + 1 }} / {{ pageCount }}</span>
          <Button variant="outline" size="sm" :disabled="page + 1 >= pageCount" @click="page++">{{ text('Далее', 'Next') }}</Button>
        </nav>
      </CollapsibleContent>
    </Collapsible>
  </section>
</template>
