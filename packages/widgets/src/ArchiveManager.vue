<script setup lang="ts">
import { Badge, Button } from '@kobaproduction/browser-ui'
import { Archive, Download, FolderOpen, Pause, Play, Settings2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import ArchiveProgressBar from './ArchiveProgressBar.vue'
import type { ArchiveManagerMode, ArchiveManagerOptions, ArchiveManagerState } from './types'

const props = defineProps<{
  state: ArchiveManagerState
  initial: ArchiveManagerOptions
  error?: string
  title?: string
}>()
const emit = defineEmits<{
  (event: 'choose-folder'): void
  (event: 'start', options: ArchiveManagerOptions): void
  (event: 'stop'): void
  (event: 'resume'): void
}>()
const mode = ref<ArchiveManagerMode>(props.initial.mode)
const limit = ref(props.initial.limit)
const from = ref(props.initial.from)
const through = ref(props.initial.through)
const pageSize = ref(props.initial.pageSize)
const delay = ref(props.initial.delay)
const media = ref(props.initial.media)
const advanced = ref(false)
const percent = computed(() =>
  props.state.total
    ? Math.min(100, Math.floor((props.state.done / props.state.total) * 100))
    : props.state.phase === 'Готово'
      ? 100
      : 0,
)
function start() {
  emit('start', {
    mode: mode.value,
    limit: Number(limit.value),
    from: from.value,
    through: through.value,
    pageSize: Number(pageSize.value),
    delay: Number(delay.value),
    media: media.value,
  })
}
</script>
<template>
  <section class="booster-setting-card">
    <div class="booster-setting-copy">
      <div class="flex items-center gap-2">
        <Archive class="size-4"/><b>{{title || 'Архив переписки'}}</b>
        <Badge :variant="state.busy?'default':'outline'">{{state.busy?'Экспорт':'Ожидание'}}</Badge>
      </div>
      <span>{{state.context}} · Сообщений в архиве: {{state.messages}}</span>
    </div>
    <Button variant="outline" size="sm" :disabled="state.busy" @click="emit('choose-folder')">
      <FolderOpen class="size-4"/>Папка
    </Button>
  </section>
  <section class="booster-setting-card">
    <div class="booster-setting-copy">
      <b>Хранилище</b><span>{{state.folder || 'Выбери папку архива'}}</span>
    </div>
  </section>
  <section class="booster-stack-card">
    <div class="booster-setting-copy"><b>Что выгружать</b><span>Без дублирования уже сохранённых сообщений</span></div>
    <div class="grid grid-cols-2 gap-3">
      <label class="booster-field">
        Режим
        <select v-model="mode" class="booster-select w-full">
          <option value="recent">Последние N</option>
          <option value="incremental">Только новые</option>
          <option value="backfill">Продолжить старые</option>
        </select>
      </label>
      <label class="booster-field">
        Количество сообщений
        <input v-model.number="limit" class="booster-input" type="number" min="1" max="100000"/>
      </label>
    </div>
    <button class="booster-disclosure" type="button" :aria-expanded="advanced" @click="advanced=!advanced">
      <span><b>Дополнительные настройки</b><small>Диапазон дат, пачка и медиафайлы</small></span>
      <Settings2 class="size-4"/>
    </button>
    <div v-if="advanced" class="grid grid-cols-2 gap-3">
      <label class="booster-field">С даты<input v-model="from" class="booster-input" type="date"/></label>
      <label class="booster-field">По дату<input v-model="through" class="booster-input" type="date"/></label>
      <label class="booster-field">Пачка<input v-model.number="pageSize" class="booster-input" type="number" min="1" max="100"/></label>
      <label class="booster-field">Пауза, мс<input v-model.number="delay" class="booster-input" type="number" min="300"/></label>
      <label class="booster-field col-span-2">
        <span class="flex items-center gap-2"><input v-model="media" type="checkbox"/>Сохранять файлы и голосовые</span>
      </label>
    </div>
  </section>
  <section class="booster-stack-card">
    <div class="flex items-center justify-between gap-2">
      <div class="booster-setting-copy"><b>Прогресс экспорта</b><span>{{state.error||state.phase||'Ожидание'}}</span></div>
      <strong class="text-base font-semibold tabular-nums">{{percent}}%</strong>
    </div>
    <ArchiveProgressBar label="Прогресс экспорта" :percent="percent" compact />
    <div class="booster-counter-grid text-xs">
      <span>Обработано <b>{{state.done}} / {{state.total}}</b></span>
      <span>Новых <b>{{state.newCount}}</b></span>
      <span>Файлов <b>{{state.downloaded}}</b></span>
      <span>Ошибки <b>{{state.failed}}</b></span>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button :disabled="state.busy||!state.folder||!!state.blockedReason" @click="start"><Download class="size-4"/>Выгрузить</Button>
      <Button variant="outline" :disabled="!state.busy" @click="emit('stop')"><Pause class="size-4"/>Пауза</Button>
      <Button variant="outline" :disabled="state.busy||!state.paused||!!state.blockedReason" @click="emit('resume')"><Play class="size-4"/>Продолжить</Button>
    </div>
    <p v-if="state.blockedReason" role="alert" class="text-sm text-destructive">{{state.blockedReason}}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{error}}</p>
  </section>
</template>
