<script setup lang="ts">
/** VK archive preview, based on the source-neutral shared transcript widget. */
import { Button } from '@kobaproduction/browser-ui'
import { ArchiveTranscript, type ArchiveTranscriptTurn } from '@kobaproduction/browser-widgets'
import { computed, ref, watch } from 'vue'
import type { ArchiveApi, ArchiveStatus, VkPreviewAttachment } from '../model/types'

const props = defineProps<{ api: ArchiveApi; status: ArchiveStatus }>()
const query = ref('')
const visibleLimit = ref(80)
const result = computed(() => {
  // Status is an immutable snapshot emitted when a file-backed archive changes.
  void props.status
  return props.api.previewMessages({ limit: visibleLimit.value, query: query.value })
})
const messageMap = computed(() => new Map(result.value.messages.map((row) => [String(row.id), row])))
const receiptMap = computed(() =>
  props.api.previewAttachments(result.value.messages.map((message) => message.id)),
)
function receiptLabel(receipt: VkPreviewAttachment): string {
  if (receipt.status === 'saved')
    return receipt.checksumRecorded
      ? 'По записи: сохранён · SHA-256'
      : 'По записи: сохранён · без SHA-256'
  if (receipt.status === 'link') return 'Ссылка (без локального файла)'
  if (receipt.status === 'failed') return 'Ошибка предыдущей загрузки'
  if (receipt.status === 'unavailable') return 'Недоступен в источнике'
  return 'Локальный файл ещё не сохранён'
}

const turns = computed<ArchiveTranscriptTurn[]>(() =>
  result.value.messages.map((message) => {
    const record = { key: String(message.id), messageId: String(message.id) }
    return {
      id: record.key,
      association: 'linked',
      users: message.out ? [record] : [],
      details: [],
      replies: message.out ? [] : [record],
    }
  }),
)
const copy = computed(() => ({
  empty: query.value ? 'Сообщения с таким текстом не найдены.' : 'В выбранном архиве ещё нет сообщений.',
  unassigned: '',
  adjacency: '',
  details: '',
}))
watch(query, () => {
  visibleLimit.value = 80
})
function dateLabel(date: number): string {
  return Number.isFinite(date) ? new Date(date * 1000).toLocaleString('ru-RU') : 'Дата неизвестна'
}
function showMore(): void {
  visibleLimit.value = Math.min(240, visibleLimit.value + 80)
}
</script>

<template>
  <section class="booster-stack-card" aria-label="Просмотр сохранённой переписки">
    <div class="booster-setting-copy">
      <b>Сообщения из архива</b>
      <span>
        Папка: {{ status.folder }} · Найдено: {{ result.matching }}
        · Показано: {{ result.messages.length }}
      </span>
    </div>
    <label class="booster-field">
      Поиск по тексту сохранённых сообщений
      <input
        v-model="query"
        class="booster-input w-full"
        type="search"
        placeholder="Введите текст сообщения…"
        autocomplete="off"
        aria-label="Поиск в локальном архиве"
      />
    </label>
    <div class="max-h-[420px] min-h-[130px] overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-background p-3">
      <ArchiveTranscript
        :turns="turns"
        :is-empty="!result.messages.length"
        :target-message-id="null"
        :copy="copy"
      >
        <template #record="{ record }">
          <div
            v-if="messageMap.get(record.key)"
            class="w-full min-w-0 rounded-lg border border-border bg-card p-3"
            :class="{ 'bg-secondary': Boolean(messageMap.get(record.key)?.out) }"
          >
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <b class="text-foreground">
                {{ messageMap.get(record.key)?.out ? 'Вы' : 'ID ' + (messageMap.get(record.key)?.from_id ?? '—') }}
              </b>
              <time>{{ dateLabel(messageMap.get(record.key)?.date ?? 0) }}</time>
            </div>
            <p class="m-0 whitespace-pre-wrap break-words text-sm text-foreground">
              {{ messageMap.get(record.key)?.text || 'Сообщение без текста' }}
            </p>
            <p v-if="messageMap.get(record.key)?.reply_message" class="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
              Ответ: {{ messageMap.get(record.key)?.reply_message?.text || 'вложение' }}
            </p>
            <p v-if="messageMap.get(record.key)?.fwd_messages?.length" class="mt-2 text-xs text-muted-foreground">
              Пересланных: {{ messageMap.get(record.key)?.fwd_messages?.length }}
            </p>
            <div v-if="receiptMap[record.key]?.length" class="mt-2 border-t border-border pt-2">
              <b class="text-xs text-foreground">Вложения (по записям архива)</b>
              <ul class="m-0 mt-1 flex flex-col gap-1 p-0" aria-label="Вложения сохранённого сообщения">
                <li
                  v-for="(receipt, index) in receiptMap[record.key]"
                  :key="index"
                  class="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground"
                >
                  <span class="break-words text-foreground">{{ receipt.name }}</span>
                  <span>{{ receiptLabel(receipt) }}</span>
                </li>
              </ul>
              <p class="m-0 mt-1 text-xs text-muted-foreground">
                Это статус из metadata.json, а не повторная проверка файла на диске.
              </p>
            </div>
          </div>
        </template>
      </ArchiveTranscript>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs text-muted-foreground">
        Для всех сообщений и сохранённых медиа открой index.html в папке архива.
      </span>
      <Button
        v-if="result.matching > result.messages.length && visibleLimit < 240"
        variant="outline"
        size="sm"
        @click="showMore"
      >Показать ещё</Button>
    </div>
    <p v-if="result.matching > result.messages.length && visibleLimit >= 240" class="m-0 text-xs text-muted-foreground">
      Показаны последние 240 совпадений. Уточни поиск, чтобы найти более ранние сообщения.
    </p>
  </section>
</template>
